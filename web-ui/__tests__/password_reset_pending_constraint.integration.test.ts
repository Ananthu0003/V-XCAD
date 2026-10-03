/**
 * @jest-environment node
 *
 * Password-reset unique-constraint fix, against a REAL database.
 *
 * Reproduces the original bug (`@@unique([userId, status])` on PasswordResetRequest broke a
 * user's SECOND-ever approved/rejected request with a genuine Postgres unique-constraint
 * violation) and proves the fix (a partial unique index, created in
 * scripts/db-bootstrap.js's grants phase, enforcing only "at most one PENDING request per
 * user") against a real Postgres instance running the actual current schema.prisma +
 * db-bootstrap.js — not a mock, not a simulated constraint.
 *
 * Skipped unless PASSWORD_RESET_TEST_DATABASE_URL is set. Point it at a database that has had
 * BOTH `prisma db push` AND `node scripts/db-bootstrap.js grants` applied against it (the real
 * migrate sequence — see README "Database"), so the partial index under test actually exists:
 *
 *   PASSWORD_RESET_TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5433/cad_db \
 *     npx jest password_reset_pending_constraint
 *
 * The admin route handlers under test are the REAL ones from
 * app/api/admin/password-reset-requests/[id]/{approve,reject}/route.ts — only @/lib/auth is
 * mocked (to avoid needing a real JWT and to keep the admin identity deterministic); Prisma and
 * rate limiting are real, against the real database.
 */

export {};

const URL_ = process.env.PASSWORD_RESET_TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;

const mockRequireAdmin = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

jest.mock('@/lib/prisma', () => {
  // Without a database URL the suite is skipped; never construct a client (it would throw at load).
  if (!process.env.PASSWORD_RESET_TEST_DATABASE_URL) return { prisma: {} };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require('@prisma/client');
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.PASSWORD_RESET_TEST_DATABASE_URL } } }) };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/lib/prisma');

const ADMIN_ID = `pr-itest-admin-${Date.now()}`;
const USER_PREFIX = 'pr-itest-user-';

function uniqueUserId() {
  return `${USER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedUser() {
  const id = uniqueUserId();
  await prisma.user.create({
    data: { id, email: `${id}@example.test`, name: 'Integration Test User', password: 'x', tokenVersion: 0 },
  });
  return id;
}

async function seedPendingRequest(userId: string, passwordHash: string) {
  return prisma.passwordResetRequest.create({
    data: {
      userId,
      passwordHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

function makeReq(): Request {
  return new Request('http://localhost:3000/api/admin/password-reset-requests/x/approve', { method: 'POST' });
}

async function callApprove(id: string) {
  const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
  return POST(makeReq(), { params: Promise.resolve({ id }) });
}

async function callReject(id: string, reason?: string) {
  const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
  const req = new Request('http://localhost:3000/api/admin/password-reset-requests/x/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason !== undefined ? { reason } : {}),
  });
  return POST(req as any, { params: Promise.resolve({ id }) });
}

d('PasswordResetRequest pending-uniqueness (real database)', () => {
  const seededUserIds: string[] = [];

  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue(ADMIN_ID);
  });

  afterAll(async () => {
    // Clean up everything this suite created; nothing else in the database is touched.
    if (seededUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function newSeededUser(): Promise<string> {
    const id = await seedUser();
    seededUserIds.push(id);
    return id;
  }

  it('1-2: first request approved, then a second request for the same user is submitted and approved successfully', async () => {
    const userId = await newSeededUser();

    const first = await seedPendingRequest(userId, 'hash-1');
    const res1 = await callApprove(first.id);
    expect(res1.status).toBe(200);

    const afterFirst = await prisma.passwordResetRequest.findUnique({ where: { id: first.id } });
    expect(afterFirst?.status).toBe('approved');

    // This exact sequence is what threw a Postgres unique-constraint violation under the old
    // @@unique([userId, status]) schema: a second row reaching 'approved' for the same user.
    const second = await seedPendingRequest(userId, 'hash-2');
    const res2 = await callApprove(second.id);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);

    const afterSecond = await prisma.passwordResetRequest.findUnique({ where: { id: second.id } });
    expect(afterSecond?.status).toBe('approved');

    // Both historical rows coexist — proves "unlimited historical approved requests" holds.
    const approvedCount = await prisma.passwordResetRequest.count({ where: { userId, status: 'approved' } });
    expect(approvedCount).toBe(2);
  });

  it('3-4: first request rejected, then a second request for the same user is submitted and rejected successfully', async () => {
    const userId = await newSeededUser();

    const first = await seedPendingRequest(userId, 'hash-1');
    const res1 = await callReject(first.id, 'first reason');
    expect(res1.status).toBe(200);

    const second = await seedPendingRequest(userId, 'hash-2');
    const res2 = await callReject(second.id, 'second reason');
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);

    const afterSecond = await prisma.passwordResetRequest.findUnique({ where: { id: second.id } });
    expect(afterSecond?.status).toBe('rejected');
    expect(afterSecond?.rejectReason).toBe('second reason');

    const rejectedCount = await prisma.passwordResetRequest.count({ where: { userId, status: 'rejected' } });
    expect(rejectedCount).toBe(2);
  });

  it('mixed history: approved then rejected then approved again all coexist for one user', async () => {
    const userId = await newSeededUser();

    const r1 = await seedPendingRequest(userId, 'h1');
    expect((await callApprove(r1.id)).status).toBe(200);

    const r2 = await seedPendingRequest(userId, 'h2');
    expect((await callReject(r2.id)).status).toBe(200);

    const r3 = await seedPendingRequest(userId, 'h3');
    expect((await callApprove(r3.id)).status).toBe(200);

    const statuses = (
      await prisma.passwordResetRequest.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { status: true } })
    ).map((r: { status: string }) => r.status);
    expect(statuses).toEqual(['approved', 'rejected', 'approved']);
  });

  it('5: a duplicate PENDING request for the same user is still prevented at the database level', async () => {
    const userId = await newSeededUser();

    await seedPendingRequest(userId, 'hash-a');

    await expect(seedPendingRequest(userId, 'hash-b')).rejects.toThrow();

    const pendingCount = await prisma.passwordResetRequest.count({ where: { userId, status: 'pending' } });
    expect(pendingCount).toBe(1);
  });

  it('5b: the pending constraint holds under real concurrency — exactly one of two simultaneous inserts succeeds', async () => {
    const userId = await newSeededUser();

    const results = await Promise.allSettled([
      seedPendingRequest(userId, 'race-a'),
      seedPendingRequest(userId, 'race-b'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const pendingCount = await prisma.passwordResetRequest.count({ where: { userId, status: 'pending' } });
    expect(pendingCount).toBe(1);
  });

  it('a pending request can still become approved after a previous non-pending row exists (no cross-status interference)', async () => {
    const userId = await newSeededUser();

    const old = await seedPendingRequest(userId, 'old');
    expect((await callReject(old.id)).status).toBe(200);

    // A NEW pending request must be insertable (the old row is 'rejected', not 'pending').
    const fresh = await seedPendingRequest(userId, 'fresh');
    expect(fresh.status).toBe('pending');

    const res = await callApprove(fresh.id);
    expect(res.status).toBe(200);
  });

  it('approve/reject still require admin authorization (unchanged by this fix)', async () => {
    const userId = await newSeededUser();
    const reqRow = await seedPendingRequest(userId, 'auth-check');

    mockRequireAdmin.mockResolvedValueOnce(null);
    const res = await callApprove(reqRow.id);
    expect(res.status).toBe(403);

    const unchanged = await prisma.passwordResetRequest.findUnique({ where: { id: reqRow.id } });
    expect(unchanged?.status).toBe('pending');
  });

  it('approving increments tokenVersion (unchanged by this fix)', async () => {
    const userId = await newSeededUser();
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });

    const reqRow = await seedPendingRequest(userId, 'tv-check');
    expect((await callApprove(reqRow.id)).status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true, password: true } });
    expect(after?.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1);
    expect(after?.password).toBe('tv-check');
  });
});
