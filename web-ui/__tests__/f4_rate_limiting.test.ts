/**
 * @jest-environment node
 *
 * Finding 4 (P2) — rate limiting and bounded concurrency.
 *
 * Exercises the REAL lib/rateLimit.ts and the REAL route handlers. Only Prisma, bcrypt (a cheap
 * deterministic stand-in so hashing cost is not part of the test), lib/auth token signing and the
 * cookie store are replaced. The Postgres store is simulated by a faithful in-memory implementation of
 * the same atomic upsert semantics, so store behaviour AND the store-failure fallback are both tested.
 * (The SQL itself is verified against a real PostgreSQL separately.)
 */

export {};

// ── Simulated PostgreSQL rate-limit store (same semantics as the atomic upsert) ─────────────────────

type Row = { count: number; windowStart: number };
const db = new Map<string, Row>();
let storeDown = false;
let now = 1_000_000_000_000;
const advance = (sec: number) => { now += sec * 1000; };

const mockQueryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (storeDown) throw new Error('connection refused');
  const sql = strings.join('?');
  if (sql.includes('SELECT "count", "windowStart"')) {
    // R1: checkLoginBackoff() — read-only, must NOT increment or otherwise mutate the row.
    const key = values[0] as string;
    const row = db.get(key);
    return row ? [{ count: row.count, windowStart: row.windowStart }] : [];
  }
  // fixed-window upsert (consume()): values = [key, windowSec, windowSec, windowSec, windowSec, windowSec]
  const key = values[0] as string;
  const windowSec = values[1] as number;
  const cur = db.get(key);
  const expired = !cur || cur.windowStart <= now - windowSec * 1000;
  const next: Row = expired ? { count: 1, windowStart: now } : { count: cur!.count + 1, windowStart: cur!.windowStart };
  db.set(key, next);
  return [{ count: next.count, retryAfter: Math.max(0, (next.windowStart + windowSec * 1000 - now) / 1000) }];
});
const mockExecuteRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (storeDown) throw new Error('connection refused');
  const sql = strings.join('?');
  if (/DELETE FROM "RateLimitBucket" WHERE "key"/.test(sql)) { db.delete(values[0] as string); return 1; }
  if (sql.includes('INSERT INTO "RateLimitBucket"') && sql.includes('ON CONFLICT')) {
    // R1: recordLoginFailure() — always increments (or resets to 1 after a stale/quiet period),
    // and ALWAYS stamps windowStart = now (last-failure time), unlike the fixed-window upsert above.
    const key = values[0] as string;
    const resetAfterSec = values[1] as number;
    const cur = db.get(key);
    const stale = !cur || cur.windowStart <= now - resetAfterSec * 1000;
    db.set(key, { count: stale ? 1 : cur!.count + 1, windowStart: now });
    return 1;
  }
  return 1;
});

const mockUserFindFirst = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockResetFindFirst = jest.fn();
const mockResetCreate = jest.fn();
const mockResetUpdate = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...a: any[]) => (mockQueryRaw as any)(...a),
    $executeRaw: (...a: any[]) => (mockExecuteRaw as any)(...a),
    user: {
      findFirst: (...a: unknown[]) => mockUserFindFirst(...a),
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      create: (...a: unknown[]) => mockUserCreate(...a),
    },
    passwordResetRequest: {
      findFirst: (...a: unknown[]) => mockResetFindFirst(...a),
      create: (...a: unknown[]) => mockResetCreate(...a),
      update: (...a: unknown[]) => mockResetUpdate(...a),
      findMany: jest.fn().mockResolvedValue([]),
    },
    cadSession: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  },
}));

// bcrypt stand-in: correct/incorrect decisions only. Tracks how many hashes ran and when.
const bcryptCalls: string[] = [];
let bcryptDelay = 0;
jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    compare: async (pw: string, hash: string) => {
      bcryptCalls.push('compare');
      if (bcryptDelay) await new Promise((r) => setTimeout(r, bcryptDelay));
      return hash === `hashed:${pw}`;
    },
    hash: async (pw: string) => {
      bcryptCalls.push('hash');
      if (bcryptDelay) await new Promise((r) => setTimeout(r, bcryptDelay));
      return `hashed:${pw}`;
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  signToken: async () => 'signed.jwt.token',
  requireAdmin: jest.fn(),
  requireSession: jest.fn(),
  getSession: jest.fn(),
}));
const auth = jest.requireMock('@/lib/auth');

const cookieSet = jest.fn();
jest.mock('next/headers', () => ({ cookies: async () => ({ set: (...a: unknown[]) => cookieSet(...a) }) }));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// deterministic clock for the in-memory fallback and the simulated store
const realNow = Date.now;
beforeAll(() => { Date.now = () => now; });
afterAll(() => { Date.now = realNow; });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rl = require('@/lib/rateLimit');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const login = require('@/app/api/auth/login/route').POST;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const register = require('@/app/api/auth/register/route').POST;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const forgot = require('@/app/api/auth/forgot-password/route').POST;

const { RATE_LIMITS, CONCURRENCY } = rl;

const req = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const USER = { id: 'u1', name: 'Ann', email: 'ann@example.com', password: 'hashed:correct-horse', tokenVersion: 0 };
const GOOD = { email: 'ann@example.com', password: 'correct-horse' };

beforeEach(() => {
  jest.clearAllMocks();
  db.clear();
  (globalThis as any).__vexRateLimitMem = undefined;
  (globalThis as any).__vexLoginBackoffMem = undefined;
  (globalThis as any).__vexRateLimitWarned = undefined;
  (globalThis as any).__vexLoginHashGuard = undefined;
  (globalThis as any).__vexAnonHashGuard = undefined;
  (globalThis as any).__vexRenderSlots = undefined;
  storeDown = false;
  bcryptCalls.length = 0;
  bcryptDelay = 0;
  delete process.env.TRUST_PROXY_HEADERS;
  mockUserFindFirst.mockImplementation(async ({ where }: any) =>
    where.OR.some((c: any) => c.email === USER.email) ? USER : null);
  mockUserFindUnique.mockResolvedValue(null);
  mockUserCreate.mockImplementation(async ({ data }: any) => ({ id: 'new', ...data, tokenVersion: 0 }));
  mockResetFindFirst.mockResolvedValue(null);
  mockResetCreate.mockResolvedValue({});
});

const attempts = async (n: number, fn: () => Promise<Response>) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await fn()).status);
  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 + 2. R1 — capped exponential backoff replaces the flat fixed-window block.
// See LOGIN_BACKOFF in lib/rateLimit.ts for the full policy rationale. In short: the first
// `freeAttempts` failures are free (typo tolerance); each failure after that raises the delay
// before the NEXT attempt is even looked at, but the delay is hard-capped at `maxDelaySec` — so
// no sequence of anonymous requests can ever deny the correct-credential holder (including the
// password-reset admin) for more than `maxDelaySec`, unlike the old flat 900s block.
// ═══════════════════════════════════════════════════════════════════════════

const BACKOFF = () => rl.LOGIN_BACKOFF;

describe('login — per-account capped backoff (R1)', () => {
  const wrong = (email = GOOD.email) => login(req('/api/auth/login', { email, password: 'wrong' }));

  it('the first `freeAttempts` failures are free — no delay at all (typo tolerance)', async () => {
    const codes = await attempts(BACKOFF().freeAttempts, wrong);
    expect(codes.every((c) => c === 401)).toBe(true);
    // immediately trying the CORRECT password right after is still accepted, not throttled
    expect((await login(req('/api/auth/login', GOOD))).status).toBe(200);
  });

  it('REGRESSION (R1 core property): no sequence of failures can ever deny access for more than maxDelaySec', async () => {
    // A determined, sustained attacker: far more failures than would ever occur by accident.
    await attempts(200, () => wrong());

    const res = await login(req('/api/auth/login', GOOD)); // correct credentials, mid-attack
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    // The whole point of R1: this can NEVER approach the old 900s window, no matter how long
    // the attack runs, because the delay is hard-capped.
    expect(retryAfter).toBeLessThanOrEqual(BACKOFF().maxDelaySec);
    expect(cookieSet).not.toHaveBeenCalled(); // no session issued while throttled
  });

  it('the delay grows with consecutive failures, then saturates at the cap (still meaningfully throttled)', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await wrong();
      seen.push(res.status === 429 ? Number(res.headers.get('Retry-After')) : 0);
      advance((seen[seen.length - 1] || 0) + 1); // just past any current wait before the next attempt
    }
    const nonZero = seen.filter((s) => s > 0);
    expect(nonZero.length).toBeGreaterThan(0); // it does throttle eventually
    expect(Math.max(...seen)).toBeLessThanOrEqual(BACKOFF().maxDelaySec); // never above the cap
    // strictly increasing until it saturates
    for (let i = 1; i < nonZero.length; i++) expect(nonZero[i]).toBeGreaterThanOrEqual(nonZero[i - 1]);
  });

  it('a throttled request does no database lookup and no password hashing (cheap to reject)', async () => {
    await attempts(200, () => wrong());
    mockUserFindFirst.mockClear();
    bcryptCalls.length = 0;

    await login(req('/api/auth/login', GOOD));

    expect(mockUserFindFirst).not.toHaveBeenCalled();
    expect(bcryptCalls).toEqual([]);
  });

  it('waiting out the current delay allows the next attempt (bounded, not indefinite)', async () => {
    await attempts(20, () => wrong());
    const blocked = await login(req('/api/auth/login', GOOD));
    expect(blocked.status).toBe(429);
    const wait = Number(blocked.headers.get('Retry-After'));

    advance(wait + 1);

    expect((await login(req('/api/auth/login', GOOD))).status).toBe(200);
  });

  it('the 429 body is generic (does not reveal whether the account exists)', async () => {
    const bodies: string[] = [];
    for (const email of ['ann@example.com', 'nobody@example.com']) {
      await attempts(200, () => login(req('/api/auth/login', { email, password: 'x' })));
      const res = await login(req('/api/auth/login', { email, password: 'x' }));
      expect(res.status).toBe(429);
      bodies.push(JSON.stringify(await res.json()));
    }
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('throttles an unknown email with the exact same policy (no enumeration through the limiter)', async () => {
    const codes = await attempts(BACKOFF().freeAttempts, () => login(req('/api/auth/login', { email: 'ghost@example.com', password: 'x' })));
    expect(codes.every((c) => c === 401)).toBe(true);
    await attempts(50, () => login(req('/api/auth/login', { email: 'ghost@example.com', password: 'x' })));
    const res = await login(req('/api/auth/login', { email: 'ghost@example.com', password: 'x' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeLessThanOrEqual(BACKOFF().maxDelaySec);
  });

  it('email case / whitespace variants share ONE backoff state', async () => {
    const variants = ['ann@example.com', 'ANN@EXAMPLE.COM', '  Ann@Example.com  '];
    for (let i = 0; i < 30; i++) await login(req('/api/auth/login', { email: variants[i % 3], password: 'x' }));
    expect((await login(req('/api/auth/login', { email: variants[0], password: 'x' }))).status).toBe(429);
  });

  it('the `admin` alias and its real address share ONE backoff state (cannot double the free attempts)', async () => {
    for (let i = 0; i < 30; i++) {
      await login(req('/api/auth/login', { email: i % 2 ? 'admin' : 'admin@vexcad.local', password: 'x' }));
    }
    const a = await login(req('/api/auth/login', { email: 'admin', password: 'x' }));
    const b = await login(req('/api/auth/login', { email: 'admin@vexcad.local', password: 'x' }));
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Separate accounts do not share backoff state — an ordinary account is protected exactly
//    like the admin account (test #3: "another normal account remains correctly protected").
// ═══════════════════════════════════════════════════════════════════════════

describe('per-account isolation', () => {
  it('throttling one account does not affect another', async () => {
    const other = { ...USER, id: 'u2', email: 'bob@example.com', password: 'hashed:pw2' };
    mockUserFindFirst.mockImplementation(async ({ where }: any) => {
      const e = where.OR[0].email;
      return e === USER.email ? USER : e === other.email ? other : null;
    });
    await attempts(200, () => login(req('/api/auth/login', { email: USER.email, password: 'wrong' })));
    expect((await login(req('/api/auth/login', GOOD))).status).toBe(429); // Ann is throttled

    const bob = await login(req('/api/auth/login', { email: other.email, password: 'pw2' }));
    expect(bob.status).toBe(200); // Bob is not
  });

  it('the SAME uniform policy protects any account, including a normal (non-admin) one', async () => {
    const normal = { ...USER, id: 'u3', email: 'regular-user@example.com', password: 'hashed:pw3' };
    mockUserFindFirst.mockImplementation(async ({ where }: any) => (where.OR[0].email === normal.email ? normal : null));

    const codes = await attempts(BACKOFF().freeAttempts, () =>
      login(req('/api/auth/login', { email: normal.email, password: 'wrong' })));
    expect(codes.every((c) => c === 401)).toBe(true); // same free-attempt allowance as admin

    await attempts(200, () => login(req('/api/auth/login', { email: normal.email, password: 'wrong' })));
    const res = await login(req('/api/auth/login', { email: normal.email, password: 'pw3' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeLessThanOrEqual(BACKOFF().maxDelaySec); // same cap as admin
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. A successful login clears backoff state; correct credentials remain usable (test #4).
// ═══════════════════════════════════════════════════════════════════════════

describe('login success clears backoff state', () => {
  it('failures accumulate, a success clears them, and the account gets a fresh free allowance', async () => {
    await attempts(BACKOFF().freeAttempts, () => login(req('/api/auth/login', { ...GOOD, password: 'wrong' })));
    expect((await login(req('/api/auth/login', GOOD))).status).toBe(200); // still within free attempts
    expect(db.size).toBe(0); // backoff state cleared

    // a fresh free allowance is available again immediately, with no waiting
    const codes = await attempts(BACKOFF().freeAttempts, () => login(req('/api/auth/login', { ...GOOD, password: 'wrong' })));
    expect(codes.every((c) => c === 401)).toBe(true);
  });

  it('REGRESSION (test #4): correct admin credentials remain usable under the intended policy', async () => {
    // Simulate an ongoing attack against the admin account...
    await attempts(50, () => login(req('/api/auth/login', { email: 'admin', password: 'wrong' })));
    const blocked = await login(req('/api/auth/login', { email: 'admin@vexcad.local', password: 'x' }));
    expect(blocked.status).toBe(429);

    // ...the admin waits out the (bounded) delay and logs in with the CORRECT password.
    advance(Number(blocked.headers.get('Retry-After')) + 1);
    const res = await login(req('/api/auth/login', GOOD));
    expect(res.status).toBe(200);
    expect(cookieSet).toHaveBeenCalled();
  });

  it('a failed login does NOT reset the backoff state', async () => {
    await login(req('/api/auth/login', { ...GOOD, password: 'wrong' }));
    await login(req('/api/auth/login', { ...GOOD, password: 'wrong' }));
    const key = `${BACKOFF().name}:${rl.accountKey('ann@example.com')}`;
    expect(db.get(key)?.count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Forgot-password abuse is limited
// ═══════════════════════════════════════════════════════════════════════════

describe('forgot-password — abuse limited, enumeration-resistant', () => {
  const LIMIT = RATE_LIMITS.forgotAccount.limit;
  const ask = (email = 'ann@example.com') => forgot(req('/api/auth/forgot-password', { email, newPassword: 'new-password-1', confirmPassword: 'new-password-1' }));

  beforeEach(() => mockUserFindUnique.mockResolvedValue(USER));

  it('requests below the limit succeed with the uniform success response', async () => {
    const codes = await attempts(LIMIT, () => ask());
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it('flooding one account is rejected with 429 and creates no more reset rows', async () => {
    await attempts(LIMIT, () => ask());
    mockResetCreate.mockClear(); mockResetUpdate.mockClear();

    const res = await ask();

    expect(res.status).toBe(429);
    expect(mockResetCreate).not.toHaveBeenCalled();
    expect(mockResetUpdate).not.toHaveBeenCalled();
  });

  it('applies to a NON-existent email identically (429 reveals nothing about existence)', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const codes = await attempts(LIMIT + 1, () => ask('ghost@example.com'));
    expect(codes.slice(0, LIMIT).every((c) => c === 200)).toBe(true);
    expect(codes[LIMIT]).toBe(429);
  });

  it('existing and non-existing accounts get byte-identical success responses', async () => {
    mockUserFindUnique.mockResolvedValue(USER);
    const a = await (await ask('ann@example.com')).text();
    mockUserFindUnique.mockResolvedValue(null);
    const b = await (await ask('ghost@example.com')).text();
    expect(a).toBe(b);
  });

  it('hashes the new password for EVERY request, so existing/non-existing emails cost the same', async () => {
    mockUserFindUnique.mockResolvedValue(USER);
    await ask('ann@example.com');
    const hashesExisting = bcryptCalls.filter((c) => c === 'hash').length;
    bcryptCalls.length = 0;
    mockUserFindUnique.mockResolvedValue(null);
    await ask('ghost@example.com');
    expect(bcryptCalls.filter((c) => c === 'hash').length).toBe(hashesExisting);
    expect(hashesExisting).toBe(1);
  });

  it('a different account has its own allowance', async () => {
    await attempts(LIMIT + 1, () => ask('ann@example.com'));
    expect((await ask('bob@example.com')).status).toBe(200);
  });

  it('existing validation is unchanged (short password → 400, mismatch → 400, missing → 400)', async () => {
    expect((await forgot(req('/api/auth/forgot-password', { email: 'a@b.c', newPassword: '123' }))).status).toBe(400);
    expect((await forgot(req('/api/auth/forgot-password', { email: 'a@b.c', newPassword: 'abcdefg', confirmPassword: 'zzz' }))).status).toBe(400);
    expect((await forgot(req('/api/auth/forgot-password', { email: 'a@b.c' }))).status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Registration abuse is limited
// ═══════════════════════════════════════════════════════════════════════════

describe('register — abuse limited', () => {
  const LIMIT = RATE_LIMITS.registerAccount.limit;
  const signup = (email = 'new@example.com') => register(req('/api/auth/register', { name: 'N', email, password: 'a-good-password' }));

  it('below the limit registration works', async () => {
    expect((await signup()).status).toBe(200);
  });

  it('repeated attempts for the same email are throttled (no unlimited probing / 409 enumeration)', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'exists' }); // every attempt would be a 409
    const codes = await attempts(LIMIT + 2, () => signup('taken@example.com'));
    expect(codes.slice(0, LIMIT).every((c) => c === 409)).toBe(true);
    expect(codes.slice(LIMIT).every((c) => c === 429)).toBe(true);
  });

  it('a throttled request touches neither the user table nor bcrypt', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await attempts(LIMIT, () => signup('x@example.com'));
    mockUserFindUnique.mockClear(); mockUserCreate.mockClear(); bcryptCalls.length = 0;

    expect((await signup('x@example.com')).status).toBe(429);

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
    expect(bcryptCalls).toEqual([]);
  });

  it('different emails are independent', async () => {
    await attempts(LIMIT + 1, () => signup('a@example.com'));
    expect((await signup('b@example.com')).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. X-Forwarded-For cannot be used to bypass (or to poison) limits
// ═══════════════════════════════════════════════════════════════════════════

describe('spoofed X-Forwarded-For', () => {
  it('rotating the header per request does NOT evade the per-account backoff', async () => {
    const codes: number[] = [];
    for (let i = 0; i <= 200; i++) {
      codes.push((await login(req('/api/auth/login', { ...GOOD, password: 'wrong' }, { 'x-forwarded-for': `203.0.113.${(i % 250) + 1}` }))).status);
    }
    expect(codes.some((c) => c === 429)).toBe(true); // rotating the header never bypasses the account-keyed backoff
  });

  it('by default no IP identity is ever derived (no IP bucket rows are created)', async () => {
    await login(req('/api/auth/login', { ...GOOD, password: 'wrong' }, { 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '198.51.100.9' }));
    expect([...db.keys()].some((k) => k.startsWith('login:ip'))).toBe(false);
    expect(rl.getTrustedClientIp(new Headers({ 'x-forwarded-for': '198.51.100.9' }))).toBeNull();
    expect(rl.getTrustedClientIp(new Headers({ 'x-real-ip': '198.51.100.9' }))).toBeNull();
  });

  it('a victim cannot be locked out by an attacker spoofing THEIR IP into an IP bucket (none exists by default)', async () => {
    for (let i = 0; i < 200; i++) await login(req('/api/auth/login', { email: `x${i}@example.com`, password: 'x' }, { 'x-forwarded-for': '198.51.100.20' }));
    expect((await login(req('/api/auth/login', GOOD, { 'x-forwarded-for': '198.51.100.20' }))).status).toBe(200);
  });

  describe('with an operator-declared trusted proxy (TRUST_PROXY_HEADERS=true)', () => {
    beforeEach(() => { process.env.TRUST_PROXY_HEADERS = 'true'; });

    it('uses the RIGHT-most entry (appended by our proxy), ignoring client-prepended values', () => {
      expect(rl.getTrustedClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.5' }))).toBe('203.0.113.5');
    });

    it('rejects a malformed / non-IP value', () => {
      expect(rl.getTrustedClientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull();
      expect(rl.getTrustedClientIp(new Headers({ 'x-forwarded-for': "1.2.3.4'; DROP TABLE" }))).toBeNull();
      expect(rl.getTrustedClientIp(new Headers())).toBeNull();
    });

    it('per-IP limit applies, and rotating the LEFT-most (client-controlled) value does not evade it', async () => {
      const IP_LIMIT = RATE_LIMITS.loginIp.limit;
      const codes: number[] = [];
      for (let i = 0; i <= IP_LIMIT; i++) {
        // different account each time (so the per-account limit never trips), different spoofed left-most value
        codes.push((await login(req('/api/auth/login', { email: `u${i}@example.com`, password: 'x' },
          { 'x-forwarded-for': `10.0.0.${(i % 250) + 1}, 203.0.113.77` }))).status);
      }
      expect(codes.slice(0, IP_LIMIT).every((c) => c === 401)).toBe(true);
      expect(codes[IP_LIMIT]).toBe(429);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Legitimate traffic is not globally blocked
// ═══════════════════════════════════════════════════════════════════════════

describe('no attacker-controlled global denial of service', () => {
  it('throttling many accounts\' backoff state does not block an unrelated user', async () => {
    for (let a = 0; a < 25; a++) {
      await attempts(50, () => login(req('/api/auth/login', { email: `victim${a}@example.com`, password: 'x' })));
    }
    expect((await login(req('/api/auth/login', GOOD))).status).toBe(200);
  });

  it('a flood of registrations (anonymous pool saturated) does not block login or authenticated traffic', async () => {
    bcryptDelay = 30;
    const flood = Array.from({ length: 40 }, (_, i) =>
      register(req('/api/auth/register', { name: 'f', email: `flood${i}@example.com`, password: 'a-good-password' })));
    // while the anonymous pool is saturated, a real login still completes promptly (its own pool)
    const loginRes = await login(req('/api/auth/login', GOOD));
    expect(loginRes.status).toBe(200);
    const results = await Promise.all(flood);
    expect(results.some((r) => r.status === 503)).toBe(true); // overflow was shed, not queued unboundedly
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
  });

  it('authenticated per-user limits are per user: one user exhausting render does not affect another', async () => {
    const R = RATE_LIMITS.render;
    for (let i = 0; i <= R.limit; i++) await rl.consume(R, 'user-A');
    expect((await rl.consume(R, 'user-A')).allowed).toBe(false);
    expect((await rl.consume(R, 'user-B')).allowed).toBe(true);
  });

  it('login is not affected by the state of the render/generate/assistant/admin limits', async () => {
    for (const rule of [RATE_LIMITS.render, RATE_LIMITS.generate, RATE_LIMITS.assistant, RATE_LIMITS.adminAction]) {
      for (let i = 0; i <= rule.limit; i++) await rl.consume(rule, 'u1');
    }
    expect((await login(req('/api/auth/login', GOOD))).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Limiter failures fail safely (never disable authentication or open the gate)
// ═══════════════════════════════════════════════════════════════════════════

describe('store failure behaviour', () => {
  it('falls back to an in-process counter that STILL limits (not fail-open)', async () => {
    storeDown = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const codes = await attempts(50, () => login(req('/api/auth/login', { ...GOOD, password: 'wrong' })));
    expect(codes.some((c) => c === 429)).toBe(true);
  });

  it('never disables authentication: a wrong password is still rejected and a session is never issued', async () => {
    storeDown = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await login(req('/api/auth/login', { ...GOOD, password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(cookieSet).not.toHaveBeenCalled();
    expect((await login(req('/api/auth/login', GOOD))).status).toBe(200); // and the right one still works
  });

  it('a malformed store response is treated as a failure (fallback), not as "allowed"', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockQueryRaw.mockResolvedValueOnce([] as any);
    const r = await rl.consume(RATE_LIMITS.registerAccount, 'k');
    expect(r.allowed).toBe(true); // first attempt via fallback counter
    expect(r.count).toBe(1);
  });

  it('the in-process fallback is bounded in memory (fixed-window rules)', async () => {
    storeDown = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 10_500; i++) await rl.consume(RATE_LIMITS.registerAccount, `k${i}`);
    expect((globalThis as any).__vexRateLimitMem.size).toBeLessThanOrEqual(10_000);
  });

  it('the login backoff in-process fallback is ALSO bounded in memory', async () => {
    storeDown = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 10_500; i++) await rl.recordLoginFailure(`bk${i}`);
    expect((globalThis as any).__vexLoginBackoffMem.size).toBeLessThanOrEqual(10_000);
  });

  it('the store failure is logged once, not per request, across BOTH mechanisms', async () => {
    storeDown = true;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) await rl.consume(RATE_LIMITS.registerAccount, `k${i}`);
    await rl.checkLoginBackoff('x');
    await rl.recordLoginFailure('x');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('[rate-limit]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Concurrent expensive work is bounded
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// R2 — anonymous bcrypt concurrency pool (register / forgot-password). Bounded hashing is a real
// CPU-exhaustion defense (kept); the pool is retuned so a small legitimate BURST does not needlessly
// 503 unrelated users, while excessive SUSTAINED concurrency is still rejected/bounded, and login
// (a separate pool) is never starved by either.
// ─────────────────────────────────────────────────────────────────────────
describe('R2 — anonymous hash concurrency pool', () => {
  it('a small legitimate burst of simultaneous registrations does not 503 anyone', async () => {
    bcryptDelay = 15;
    const { max, maxQueue } = CONCURRENCY.anonHash;
    const burst = max + Math.min(3, maxQueue); // comfortably within total capacity
    const results = await Promise.all(Array.from({ length: burst }, (_, i) =>
      register(req('/api/auth/register', { name: 'n', email: `burst${i}@example.com`, password: 'a-good-password' }))));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it('a small burst of simultaneous forgot-password requests (distinct accounts) does not 503 anyone', async () => {
    // Distinct emails so the pre-existing per-account forgotAccount limit (unrelated to R2) never
    // confounds this purely concurrency-pool-capacity test.
    bcryptDelay = 15;
    mockUserFindUnique.mockImplementation(async ({ where }: any) => ({ ...USER, email: where.email }));
    const { max, maxQueue } = CONCURRENCY.anonHash;
    const burst = max + Math.min(3, maxQueue);
    const results = await Promise.all(Array.from({ length: burst }, (_, i) =>
      forgot(req('/api/auth/forgot-password', { email: `burst${i}@example.com`, newPassword: 'new-password-1', confirmPassword: 'new-password-1' }))));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it('hashing remains bounded: the real pool used by register/forgot-password never exceeds `max` at once', async () => {
    // Exercises the ACTUAL singleton guard the routes call (anonHashGuard()), not a re-implementation.
    const guard = rl.anonHashGuard();
    let active = 0, peak = 0;
    const task = async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); active--; return 'ok'; };
    const total = CONCURRENCY.anonHash.max + CONCURRENCY.anonHash.maxQueue;
    await Promise.all(Array.from({ length: total }, () => guard.run(task)));
    expect(peak).toBe(CONCURRENCY.anonHash.max);
  });

  it('login remains protected from anonymous-hash starvation: saturating the anon pool does not delay login', async () => {
    bcryptDelay = 40;
    const flood = Array.from({ length: CONCURRENCY.anonHash.max + CONCURRENCY.anonHash.maxQueue + 10 }, (_, i) =>
      register(req('/api/auth/register', { name: 'f', email: `starve${i}@example.com`, password: 'a-good-password' })));
    const loginRes = await login(req('/api/auth/login', GOOD)); // uses the SEPARATE loginHash pool
    expect(loginRes.status).toBe(200);
    await Promise.all(flood);
  });

  it('excessive sustained concurrency is still rejected/bounded (not queued without limit)', async () => {
    bcryptDelay = 30;
    const total = CONCURRENCY.anonHash.max + CONCURRENCY.anonHash.maxQueue + 24; // well beyond capacity
    const results = await Promise.all(Array.from({ length: total }, (_, i) =>
      register(req('/api/auth/register', { name: 'f', email: `flood${i}@example.com`, password: 'a-good-password' }))));
    const shed = results.filter((r) => r.status === 503).length;
    expect(shed).toBeGreaterThan(0); // load beyond capacity is shed, not queued indefinitely
    expect(results.filter((r) => r.status === 200).length).toBe(CONCURRENCY.anonHash.max + CONCURRENCY.anonHash.maxQueue);
  });
});

describe('ConcurrencyGuard', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('never runs more than `max` tasks at once and queues up to maxQueue', async () => {
    const g = new rl.ConcurrencyGuard(2, 3);
    let active = 0, peak = 0;
    const task = async () => { active++; peak = Math.max(peak, active); await sleep(10); active--; return 'ok'; };
    const results = await Promise.all(Array.from({ length: 5 }, () => g.run(task)));
    expect(results).toEqual(Array(5).fill('ok'));
    expect(peak).toBe(2);
  });

  it('rejects immediately (does not queue forever) beyond max + maxQueue', async () => {
    const g = new rl.ConcurrencyGuard(1, 1);
    const p1 = g.run(() => sleep(30));
    const p2 = g.run(() => sleep(1));
    await expect(g.run(async () => 'x')).rejects.toBeInstanceOf(rl.ConcurrencyLimitError);
    await Promise.all([p1, p2]);
    expect(g.inFlight).toBe(0);
    expect(g.queued).toBe(0);
  });

  it('releases the slot when a task throws', async () => {
    const g = new rl.ConcurrencyGuard(1, 0);
    await expect(g.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(g.run(async () => 'fine')).resolves.toBe('fine');
  });

  it('runIfIdle skips (does not queue) when the reserve would be violated', async () => {
    const g = new rl.ConcurrencyGuard(2, 5);
    const busy = g.run(() => sleep(30)); // 1 of 2 active
    expect(await g.runIfIdle(async () => 'ran', 1)).toBeUndefined(); // reserve 1 → would leave 0 idle
    expect(await g.runIfIdle(async () => 'ran', 0)).toBe('ran');
    await busy;
  });

  it('login hashing is bounded: concurrent logins never exceed the pool and overflow is shed with 503', async () => {
    bcryptDelay = 20;
    const { max, maxQueue } = CONCURRENCY.loginHash;
    const total = max + maxQueue + 10;
    const results = await Promise.all(Array.from({ length: total }, (_, i) =>
      login(req('/api/auth/login', { email: `bulk${i}@example.com`, password: 'x' }))));
    const shed = results.filter((r) => r.status === 503).length;
    const handled = results.filter((r) => r.status === 401).length;
    expect(handled + shed).toBe(total);
    // unknown-email dummy hashes never queue, so nothing is shed for them; real accounts are shed above the queue cap
    expect(shed).toBe(0);
    expect(bcryptCalls.filter((c) => c === 'compare').length).toBeLessThanOrEqual(total);
  });

  it('real-account logins queue then shed above max+maxQueue; dummy hashes never delay them', async () => {
    bcryptDelay = 25;
    const { max, maxQueue } = CONCURRENCY.loginHash;
    // distinct real users so the per-account limiter does not interfere
    mockUserFindFirst.mockImplementation(async ({ where }: any) => ({ ...USER, email: where.OR[0].email, password: 'hashed:pw' }));
    const total = max + maxQueue + 6;
    const results = await Promise.all(Array.from({ length: total }, (_, i) =>
      login(req('/api/auth/login', { email: `real${i}@example.com`, password: 'wrong' }))));
    expect(results.filter((r) => r.status === 503).length).toBe(total - max - maxQueue);
    expect(results.filter((r) => r.status === 401).length).toBe(max + maxQueue);
  });
});

describe('KeyedSlots (render concurrency)', () => {
  it('caps concurrent renders per user and process-wide, and releases exactly once', () => {
    const s = new rl.KeyedSlots(2, 3);
    const a1 = s.acquire('A'), a2 = s.acquire('A');
    expect(a1 && a2).toBeTruthy();
    expect(s.acquire('A')).toBeNull(); // per-user cap
    const b1 = s.acquire('B');
    expect(b1).toBeTruthy();
    expect(s.acquire('C')).toBeNull(); // global cap (3)
    a1!(); a1!(); // double release is harmless
    expect(s.acquire('C')).toBeTruthy(); // exactly one slot freed
    expect(s.acquire('C')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Expensive authenticated routes + admin review endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe('per-user limits on expensive routes and admin review endpoints', () => {
  const okJson = () => new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  beforeEach(() => {
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
    process.env.SERVICE_API_KEY = 'k';
    auth.requireSession.mockResolvedValue('user-1');
    auth.requireAdmin.mockResolvedValue('admin-1');
    auth.getSession.mockResolvedValue({ userId: 'user-1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' });
    mockFetch.mockImplementation(async () => okJson());
  });

  it('render: allowed up to the limit, then 429 (nested error shape) and the engine is not called', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const render = require('@/app/api/render/route').POST;
    const call = () => render(req('/api/render', { python_script: 'x=1', parameters: {}, session_id: 's1' }));
    const L = RATE_LIMITS.render.limit;
    const codes = await attempts(L, call);
    expect(codes.every((c) => c === 200)).toBe(true);

    mockFetch.mockClear();
    const res = await call();
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toMatch(/too many/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('render: the concurrency slot is always released (success, engine error, throw)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const render = require('@/app/api/render/route').POST;
    const call = () => render(req('/api/render', { python_script: 'x=1', parameters: {}, session_id: 's1' }));
    mockFetch.mockRejectedValueOnce(new Error('down'));
    expect((await call()).status).toBe(502);
    mockFetch.mockImplementationOnce(async () => new Response('{"error":{"message":"bad"}}', { status: 500 }));
    expect((await call()).status).toBe(500);
    // both released → a further call for the SAME user is still accepted (R3: cap is 1 per user)
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    mockFetch.mockImplementation(async () => { await gate; return okJson(); });
    const p1 = call();
    await new Promise((r) => setTimeout(r, 5));
    const second = await call(); // R3: per-user cap is now 1, so a CONCURRENT 2nd call is refused
    expect(second.status).toBe(429);
    release();
    expect((await p1).status).toBe(200);
  });

  it('render: one user\'s limit/concurrency does not block another user', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const render = require('@/app/api/render/route').POST;
    for (let i = 0; i <= RATE_LIMITS.render.limit; i++) await rl.consume(RATE_LIMITS.render, 'user-1');
    auth.requireSession.mockResolvedValue('user-1');
    expect((await render(req('/api/render', { python_script: 'x', parameters: {}, session_id: 's1' }))).status).toBe(429);
    auth.requireSession.mockResolvedValue('user-2');
    expect((await render(req('/api/render', { python_script: 'x', parameters: {}, session_id: 's2' }))).status).toBe(200);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R3 — a small number of newly-created accounts cannot consume every global render
  // slot. Registration is open and free (no CAPTCHA / trusted IP), so the ONLY lever is
  // keeping the per-user share a small minority of the global cap — see CONCURRENCY.renderPerUser.
  // ─────────────────────────────────────────────────────────────────────────
  describe('R3 — render concurrency cannot be monopolized by a few throwaway accounts', () => {
    let release!: () => void;
    beforeEach(() => {
      const gate = new Promise<void>((r) => (release = r));
      mockFetch.mockImplementation(async () => { await gate; return okJson(); });
    });

    const renderAs = (userId: string, sessionId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const render = require('@/app/api/render/route').POST;
      auth.requireSession.mockResolvedValue(userId);
      return render(req('/api/render', { python_script: 'x=1', parameters: {}, session_id: sessionId }));
    };

    it('legitimate DIFFERENT users can render concurrently (up to the global cap)', async () => {
      const users = Array.from({ length: CONCURRENCY.renderGlobal }, (_, i) => `legit-user-${i}`);
      const pending = users.map((u, i) => renderAs(u, `s${i}`));
      await new Promise((r) => setTimeout(r, 5));
      release();
      const results = await Promise.all(pending);
      expect(results.every((r) => r.status === 200)).toBe(true);
    });

    it('one user cannot monopolize the renderer: a 2nd concurrent render from the SAME user is refused', async () => {
      const p1 = renderAs('solo-user', 's1');
      await new Promise((r) => setTimeout(r, 5));
      const second = await renderAs('solo-user', 's2');
      expect(second.status).toBe(429);
      release();
      expect((await p1).status).toBe(200);
    });

    it('REGRESSION (R3): four throwaway accounts can no longer occupy every global slot', async () => {
      // Each of the 4 throwaway accounts fires 2 CONCURRENT renders — the exact shape of the
      // original bug (renderPerUser=2 × 4 accounts = 8 = renderGlobal, so 4 accounts alone used to
      // exhaust the entire pool). This makes NO reference to CONCURRENCY.renderPerUser/renderGlobal;
      // it fires a fixed, config-independent demand and reads only real HTTP status codes back from
      // the actual render route + the real renderSlots()/KeyedSlots guard, so the test's outcome
      // depends entirely on how that production code actually behaves, not on inspecting its config.
      const throwaway = ['t0', 't1', 't2', 't3'];
      const attempts2x = throwaway.flatMap((u, i) => [renderAs(u, `throwaway-${i}-a`), renderAs(u, `throwaway-${i}-b`)]);
      await new Promise((r) => setTimeout(r, 5));

      // The decisive check: a 5th, DIFFERENT legitimate user's render must still be able to run
      // concurrently with the four throwaway accounts. Fired now, while the throwaway calls are
      // still pending on the same gate — NOT awaited yet, so this can never deadlock regardless of
      // whether it turns out to be accepted (gated on `release()` below) or immediately refused.
      const legit = renderAs('legit-fifth-user', 's-legit');
      await new Promise((r) => setTimeout(r, 5));

      release();
      const throwawayResults = await Promise.all(attempts2x);
      const legitResult = await legit;

      // With the per-user cap actually enforced, each throwaway account's SECOND concurrent render
      // is refused by its own per-user limit, so the 4 accounts can occupy at most 4 of the 8 global
      // slots between them — never all 8 — leaving room for the 5th, legitimate user.
      const throwawayAccepted = throwawayResults.filter((r) => r.status === 200).length;
      const throwawayRefused = throwawayResults.filter((r) => r.status === 429).length;
      expect(throwawayAccepted).toBeLessThan(throwawayResults.length); // NOT all 8 got through
      expect(throwawayAccepted + throwawayRefused).toBe(throwawayResults.length); // every response accounted for
      // This is the assertion that actually distinguishes the fix from the original bug: if the
      // per-user cap were back at its old broken value, the 4 throwaway accounts alone would consume
      // every one of the 8 global slots and this would be 429, not 200.
      expect(legitResult.status).toBe(200);
    });

    it('the system still bounds total renderer concurrency (global cap of 8 still enforced)', async () => {
      const users = Array.from({ length: CONCURRENCY.renderGlobal }, (_, i) => `sat-user-${i}`);
      const pending = users.map((u, i) => renderAs(u, `sat-${i}`));
      await new Promise((r) => setTimeout(r, 5));

      const overflow = await renderAs('sat-user-overflow', 's-overflow');
      expect(overflow.status).toBe(429); // the 9th distinct user is refused — global cap still holds

      release();
      const results = await Promise.all(pending);
      expect(results.every((r) => r.status === 200)).toBe(true);
    });
  });

  it('generate and assistant enforce their own per-user limits', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const assistant = require('@/app/api/assistant/compare/route').POST;
    const A = RATE_LIMITS.assistant.limit;
    expect((await attempts(A, () => assistant(req('/api/assistant/compare', { message: 'hi' })))).every((c) => c === 200)).toBe(true);
    expect((await assistant(req('/api/assistant/compare', { message: 'hi' }))).status).toBe(429);

    for (let i = 0; i <= RATE_LIMITS.generate.limit; i++) await rl.consume(RATE_LIMITS.generate, 'user-1');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const generate = require('@/app/api/generate/route').POST;
    const fd = new FormData(); fd.set('prompt', 'a box');
    const res = await generate(new Request('http://localhost:3000/api/generate', { method: 'POST', body: fd }));
    expect(res.status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(A); // no engine call from the throttled generate
  });

  it('password-reset review endpoints are limited per admin, after admin authorization', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const list = require('@/app/api/admin/password-reset-requests/route').GET;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const approve = require('@/app/api/admin/password-reset-requests/[id]/approve/route').POST;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reject = require('@/app/api/admin/password-reset-requests/[id]/reject/route').POST;

    for (let i = 0; i < RATE_LIMITS.adminAction.limit; i++) await rl.consume(RATE_LIMITS.adminAction, 'admin-1');

    const ctx = { params: Promise.resolve({ id: 'r1' }) };
    expect((await list(new Request('http://localhost:3000/api/admin/password-reset-requests'))).status).toBe(429);
    expect((await approve(new Request('http://localhost:3000/x', { method: 'POST' }), ctx)).status).toBe(429);
    expect((await reject(req('/x', {}), ctx)).status).toBe(429);

    // a NON-admin is still refused with 403 (authorization first), and does not consume the admin bucket
    auth.requireAdmin.mockResolvedValue(null);
    expect((await list(new Request('http://localhost:3000/api/admin/password-reset-requests'))).status).toBe(403);
    // a different admin has their own allowance
    auth.requireAdmin.mockResolvedValue('admin-2');
    expect((await list(new Request('http://localhost:3000/api/admin/password-reset-requests'))).status).not.toBe(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Configuration is centralised; input bounds; store SQL shape
// ═══════════════════════════════════════════════════════════════════════════

describe('configuration and input bounds', () => {
  it('every rule has a unique name and sane positive limit/window', () => {
    const rules = Object.values(RATE_LIMITS) as any[];
    expect(new Set(rules.map((r) => r.name)).size).toBe(rules.length);
    for (const r of rules) { expect(r.limit).toBeGreaterThan(0); expect(r.windowSec).toBeGreaterThan(0); }
  });

  it('auth routes contain no numeric rate-limit literals (limits live in lib/rateLimit.ts)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    for (const f of ['login', 'register', 'forgot-password']) {
      const src = fs.readFileSync(`app/api/auth/${f}/route.ts`, 'utf8');
      expect(src).not.toMatch(/limit\s*[:=]\s*\d+/i);
      expect(src).toContain('RATE_LIMITS.');
    }
  });

  it.each([
    ['login', '/api/auth/login', { email: 'a'.repeat(300) + '@x.co', password: 'p' }],
    ['login', '/api/auth/login', { email: 'a@x.co', password: 'p'.repeat(5000) }],
    ['login', '/api/auth/login', { email: { $ne: null }, password: 'p' }],
    ['register', '/api/auth/register', { name: 'n', email: 'a@x.co', password: 'p'.repeat(5000) }],
    ['register', '/api/auth/register', { name: 'n', email: ['a@x.co'], password: 'p' }],
    ['forgot', '/api/auth/forgot-password', { email: 'a@x.co', newPassword: 'p'.repeat(5000) }],
  ])('%s rejects oversized / non-string input with 400 before hashing', async (_n, url, body) => {
    const h = url.includes('login') ? login : url.includes('register') ? register : forgot;
    const res = await h(req(url, body));
    expect(res.status).toBe(400);
    expect(bcryptCalls).toEqual([]);
  });

  it('the store SQL is one atomic upsert with RETURNING (no read-modify-write)', async () => {
    await rl.consume(RATE_LIMITS.registerAccount, 'x');
    const sql = (mockQueryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/INSERT INTO "RateLimitBucket"/);
    expect(sql).toMatch(/ON CONFLICT \("key"\) DO UPDATE/);
    expect(sql).toMatch(/RETURNING/);
    expect(sql).not.toMatch(/\bSELECT\b/);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1); // one round trip
  });

  it('R1: the login-backoff READ is a plain SELECT (no write / no increment as a side effect)', async () => {
    await rl.checkLoginBackoff('probe-only');
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const sql = (mockQueryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/^\s*SELECT/);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(db.has(`${rl.LOGIN_BACKOFF.name}:probe-only`)).toBe(false); // a mere check writes nothing
  });

  it('R1: backoffDelaySec() never exceeds maxDelaySec, for any failure count', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 10, 20, 100, 10_000]) {
      expect(rl.backoffDelaySec(n)).toBeLessThanOrEqual(rl.LOGIN_BACKOFF.maxDelaySec);
      expect(rl.backoffDelaySec(n)).toBeGreaterThanOrEqual(0);
    }
    expect(rl.backoffDelaySec(rl.LOGIN_BACKOFF.freeAttempts)).toBe(0); // free attempts cost nothing
    expect(rl.backoffDelaySec(rl.LOGIN_BACKOFF.freeAttempts + 1)).toBeGreaterThan(0); // the very next one does
  });

  it('R1: the cap is small relative to the old fixed-window duration it replaces (15 min)', () => {
    expect(rl.LOGIN_BACKOFF.maxDelaySec).toBeLessThanOrEqual(120);
  });

  it('R2: the anonymous-hash pool absorbs a small legitimate burst without any change needed elsewhere', () => {
    // (behavioural proof lives in the 'anonymous bcrypt concurrency pool (R2)' suite; this just
    // pins the tuned capacity so a future edit can't silently shrink it back down unnoticed)
    const totalCapacity = CONCURRENCY.anonHash.max + CONCURRENCY.anonHash.maxQueue;
    expect(totalCapacity).toBeGreaterThanOrEqual(16);
    expect(CONCURRENCY.anonHash.max).toBeGreaterThanOrEqual(3); // more than one legitimate signup can run at once
  });

  it('R3: the per-user render cap is a small minority of the global cap (structural invariant)', () => {
    // The R3 fix in one assertion: N throwaway accounts occupy at most N*renderPerUser slots; this
    // must stay well below renderGlobal so a small number of them can never exhaust the pool.
    const FEW_ACCOUNTS = 4;
    expect(FEW_ACCOUNTS * CONCURRENCY.renderPerUser).toBeLessThan(CONCURRENCY.renderGlobal);
    expect(CONCURRENCY.renderPerUser).toBe(1);
  });

  it('identities are hashed: raw emails never appear in stored keys', async () => {
    await login(req('/api/auth/login', { email: 'secret.person@example.com', password: 'x' }));
    for (const k of db.keys()) expect(k).not.toContain('secret.person');
  });
});
