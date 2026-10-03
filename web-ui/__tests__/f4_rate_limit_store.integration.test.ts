/**
 * @jest-environment node
 *
 * Finding 4 — the PostgreSQL rate-limit store, against a REAL database.
 *
 * Skipped unless RATE_LIMIT_TEST_DATABASE_URL is set. Point it at a database that has had
 * `prisma db push` + the grants applied (see README "Database"), connecting as the LEAST-PRIVILEGE
 * application role — so a pass also proves that role can use the RateLimitBucket table.
 *
 *   RATE_LIMIT_TEST_DATABASE_URL=postgresql://vexcad_app:…@127.0.0.1:5433/cad_db npx jest f4_rate_limit_store
 */

export {};

const URL_ = process.env.RATE_LIMIT_TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;

jest.mock('@/lib/prisma', () => {
  // Without a database URL the suite is skipped; never construct a client (it would throw at load).
  if (!process.env.RATE_LIMIT_TEST_DATABASE_URL) return { prisma: {} };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require('@prisma/client');
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.RATE_LIMIT_TEST_DATABASE_URL } } }) };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rl = require('@/lib/rateLimit');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/lib/prisma');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rule = (limit: number, windowSec: number) => ({ name: `itest:${Math.random().toString(36).slice(2)}`, limit, windowSec });

d('PostgreSQL-backed rate-limit store (real database)', () => {
  let consoleError: jest.SpyInstance;
  beforeAll(() => { consoleError = jest.spyOn(console, 'error'); });
  afterAll(async () => {
    // the store must have been used for real — never the in-process fallback
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('[rate-limit]'), expect.anything());
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'itest:%'`;
    await prisma.$disconnect();
  });

  it('is atomic under concurrency: N parallel attempts yield exactly N counted, `limit` allowed', async () => {
    const r = rule(50, 60);
    const results = await Promise.all(Array.from({ length: 200 }, () => rl.consume(r, 'same-identity')));
    expect(results.filter((x: any) => x.allowed)).toHaveLength(50);
    expect(Math.max(...results.map((x: any) => x.count))).toBe(200);
    expect(new Set(results.map((x: any) => x.count)).size).toBe(200); // no two callers saw the same count
  });

  it('counts per identity independently', async () => {
    const r = rule(1, 60);
    expect((await rl.consume(r, 'a')).allowed).toBe(true);
    expect((await rl.consume(r, 'a')).allowed).toBe(false);
    expect((await rl.consume(r, 'b')).allowed).toBe(true);
  });

  it('reports a sane Retry-After and does not extend the window on further attempts', async () => {
    const r = rule(1, 30);
    await rl.consume(r, 'x');
    const first = await rl.consume(r, 'x');
    await sleep(1100);
    const later = await rl.consume(r, 'x');
    expect(first.retryAfterSec).toBeGreaterThan(0);
    expect(first.retryAfterSec).toBeLessThanOrEqual(30);
    expect(later.retryAfterSec).toBeLessThan(first.retryAfterSec); // window is fixed, not sliding
  });

  it('resets the counter when the window elapses', async () => {
    const r = rule(2, 1);
    await rl.consume(r, 'w'); await rl.consume(r, 'w');
    expect((await rl.consume(r, 'w')).allowed).toBe(false);
    await sleep(1300);
    const after = await rl.consume(r, 'w');
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
  });

  it('reset() clears an identity immediately', async () => {
    const r = rule(1, 60);
    await rl.consume(r, 'z'); await rl.consume(r, 'z');
    expect((await rl.consume(r, 'z')).allowed).toBe(false);
    await rl.reset(r, 'z');
    expect((await rl.consume(r, 'z')).allowed).toBe(true);
  });

  it('enforce() returns the denied result and skips identities that are not available (no trusted IP)', async () => {
    const strict = rule(1, 60);
    const loose = rule(100, 60);
    expect(await rl.enforce([[strict, 'e'], [loose, null], [loose, undefined]])).toBeNull();
    const denied = await rl.enforce([[strict, 'e'], [loose, 'e']]);
    expect(denied?.allowed).toBe(false);
  });

  it('the application role cannot ALTER or TRUNCATE the table (least-privilege sanity)', async () => {
    await expect(prisma.$executeRawUnsafe('ALTER TABLE "RateLimitBucket" ADD COLUMN evil int')).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe('TRUNCATE "RateLimitBucket"')).rejects.toBeTruthy();
  });
});
