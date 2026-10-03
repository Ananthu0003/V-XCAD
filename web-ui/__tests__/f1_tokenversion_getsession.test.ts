/**
 * @jest-environment node
 *
 * Finding 1 (P2) — getSession() must enforce tokenVersion.
 *
 * Unlike the older suites (which `jest.mock('@/lib/auth')` and therefore never
 * execute the real comparison), these tests run the REAL lib/auth.ts. Only the
 * cookie store and Prisma are mocked, so the tokenVersion logic is exercised
 * end to end, including through the route handlers that were previously
 * vulnerable because they called the signature-only getSession().
 */

export {};

process.env.JWT_SECRET = 'test-secret-for-f1-tokenversion-suite';

// ── Mocks ─────────────────────────────────────────────────────────────────

// `jose` ships ESM only and this repo's Jest setup does not transform node_modules, so the
// real package cannot be loaded here (which is also why no older suite ever ran lib/auth.ts).
// This stand-in implements HS256 sign/verify (signature AND expiry are checked) with Node's
// crypto. It is only a token codec: the behaviour under test — the tokenVersion / user checks
// in getSession() — lives in lib/auth.ts and runs for real.
jest.mock('jose', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto');
  const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const mac = (data: string, key: Uint8Array) => nodeCrypto.createHmac('sha256', Buffer.from(key)).update(data).digest('base64url');
  class SignJWT {
    private p: Record<string, unknown>;
    private h: Record<string, unknown> = { alg: 'HS256' };
    constructor(payload: Record<string, unknown>) { this.p = { ...payload }; }
    setProtectedHeader(h: Record<string, unknown>) { this.h = h; return this; }
    setIssuedAt(t?: number) { this.p.iat = t ?? Math.floor(Date.now() / 1000); return this; }
    setExpirationTime(t: number | string) {
      this.p.exp = typeof t === 'number' ? t : Math.floor(Date.now() / 1000) + (parseInt(t, 10) || 0) * 86400;
      return this;
    }
    async sign(key: Uint8Array) {
      const data = `${b64(this.h)}.${b64(this.p)}`;
      return `${data}.${mac(data, key)}`;
    }
  }
  async function jwtVerify(token: string, key: Uint8Array) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('JWSInvalid');
    const expected = mac(`${parts[0]}.${parts[1]}`, key);
    if (expected.length !== parts[2].length || !nodeCrypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) {
      throw new Error('JWSSignatureVerificationFailed');
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('JWTExpired');
    return { payload };
  }
  return { SignJWT, jwtVerify };
});

let cookieValue: string | undefined;
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'auth_token' && cookieValue ? { value: cookieValue } : undefined),
  }),
}));

const mockUserFindUnique = jest.fn();
const mockCadSession = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  create: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    cadSession: {
      findUnique: (...a: unknown[]) => mockCadSession.findUnique(...a),
      findMany: (...a: unknown[]) => mockCadSession.findMany(...a),
      update: (...a: unknown[]) => mockCadSession.update(...a),
      delete: (...a: unknown[]) => mockCadSession.delete(...a),
      deleteMany: (...a: unknown[]) => mockCadSession.deleteMany(...a),
      create: (...a: unknown[]) => mockCadSession.create(...a),
    },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const auth = require('@/lib/auth');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SignJWT } = require('jose');

const USER_ID = 'user-1';

/** What the "database" currently says about the user. */
let dbUser: { id: string; tokenVersion: number; isAdmin?: boolean } | null;

async function tokenFor(tokenVersion: number | undefined, userId = USER_ID) {
  if (tokenVersion === undefined) {
    // legacy token: no tokenVersion claim at all
    return await new SignJWT({ userId, email: 'u@test.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  }
  return await auth.signToken({ userId, email: 'u@test.com', tokenVersion });
}

beforeEach(() => {
  jest.resetAllMocks();
  cookieValue = undefined;
  dbUser = { id: USER_ID, tokenVersion: 0, isAdmin: false };
  mockUserFindUnique.mockImplementation(async (args: any) => {
    if (!dbUser || args.where.id !== dbUser.id) return null;
    const out: any = {};
    for (const k of Object.keys(args.select ?? { id: true })) out[k] = (dbUser as any)[k];
    return out;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1–5. Core behaviour of getSession / requireSession / requireAdmin
// ═══════════════════════════════════════════════════════════════════════════

describe('getSession() — tokenVersion enforcement', () => {
  it('accepts a valid JWT whose tokenVersion matches the database', async () => {
    cookieValue = await tokenFor(0);

    const session = await auth.getSession();

    expect(session?.userId).toBe(USER_ID);
    expect(session?.tokenVersion).toBe(0);
    expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: rejects a JWT issued before tokenVersion was incremented', async () => {
    cookieValue = await tokenFor(0); // issued while tokenVersion was 0
    dbUser!.tokenVersion = 1; // admin approved a password reset

    expect(await auth.getSession()).toBeNull();
  });

  it('accepts a token re-issued after the increment (new login)', async () => {
    dbUser!.tokenVersion = 1;
    cookieValue = await tokenFor(1);

    expect((await auth.getSession())?.userId).toBe(USER_ID);
  });

  it('rejects when there is no auth cookie', async () => {
    expect(await auth.getSession()).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a malformed token without a database lookup', async () => {
    cookieValue = 'not.a.jwt';

    expect(await auth.getSession()).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different secret', async () => {
    cookieValue = await new SignJWT({ userId: USER_ID, email: 'u@test.com', tokenVersion: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode('some-other-secret'));

    expect(await auth.getSession()).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    cookieValue = await new SignJWT({ userId: USER_ID, email: 'u@test.com', tokenVersion: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));

    expect(await auth.getSession()).toBeNull();
  });

  it('rejects a legacy token that has no tokenVersion claim', async () => {
    cookieValue = await tokenFor(undefined);

    expect(await auth.getSession()).toBeNull();
  });

  it('rejects a token for a user that no longer exists', async () => {
    cookieValue = await tokenFor(0);
    dbUser = null;

    expect(await auth.getSession()).toBeNull();
  });

  it('fails closed (throws) on a database error — never treated as authenticated', async () => {
    cookieValue = await tokenFor(0);
    mockUserFindUnique.mockRejectedValue(new Error('db down'));

    await expect(auth.getSession()).rejects.toThrow('db down');
  });
});

describe('requireSession() — behaviour preserved', () => {
  it('returns the userId for a current token', async () => {
    cookieValue = await tokenFor(0);
    expect(await auth.requireSession()).toBe(USER_ID);
  });

  it('returns null for a stale token', async () => {
    cookieValue = await tokenFor(0);
    dbUser!.tokenVersion = 3;
    expect(await auth.requireSession()).toBeNull();
  });

  it('returns null with no cookie / unknown user', async () => {
    expect(await auth.requireSession()).toBeNull();
    cookieValue = await tokenFor(0);
    dbUser = null;
    expect(await auth.requireSession()).toBeNull();
  });

  it('performs exactly one user lookup (no double query after the refactor)', async () => {
    cookieValue = await tokenFor(0);
    await auth.requireSession();
    expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
  });
});

describe('requireAdmin() — behaviour preserved', () => {
  it('returns the userId for an admin with a current token', async () => {
    dbUser = { id: USER_ID, tokenVersion: 0, isAdmin: true };
    cookieValue = await tokenFor(0);
    expect(await auth.requireAdmin()).toBe(USER_ID);
  });

  it('returns null for a non-admin', async () => {
    cookieValue = await tokenFor(0);
    expect(await auth.requireAdmin()).toBeNull();
  });

  it('returns null for an admin holding a stale token', async () => {
    dbUser = { id: USER_ID, tokenVersion: 1, isAdmin: true };
    cookieValue = await tokenFor(0);
    expect(await auth.requireAdmin()).toBeNull();
  });

  it('reflects demotion immediately (isAdmin is read live)', async () => {
    dbUser = { id: USER_ID, tokenVersion: 0, isAdmin: true };
    cookieValue = await tokenFor(0);
    expect(await auth.requireAdmin()).toBe(USER_ID);
    dbUser!.isAdmin = false;
    expect(await auth.requireAdmin()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Intentionally signature-only (database-independent) paths still work
// ═══════════════════════════════════════════════════════════════════════════

describe('signature-only paths remain database-independent', () => {
  it('getUnverifiedSession() returns claims without touching the database', async () => {
    cookieValue = await tokenFor(0);
    dbUser!.tokenVersion = 9; // stale, but this helper is signature-only by design

    const claims = await auth.getUnverifiedSession();

    expect(claims?.userId).toBe(USER_ID);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('getUnverifiedSession() still rejects a bad signature / missing cookie', async () => {
    expect(await auth.getUnverifiedSession()).toBeNull();
    cookieValue = 'garbage';
    expect(await auth.getUnverifiedSession()).toBeNull();
  });

  it('verifyToken() is unchanged: signature + expiry only', async () => {
    const good = await tokenFor(0);
    expect((await auth.verifyToken(good))?.userId).toBe(USER_ID);
    expect(await auth.verifyToken('nope')).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('proxy.ts (/workspace gate) still works and never queries the database', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { proxy } = require('@/proxy');
    const mk = (token?: string) => ({
      nextUrl: { pathname: '/workspace' },
      url: 'http://localhost:3000/workspace',
      cookies: { get: (n: string) => (n === 'auth_token' && token ? { value: token } : undefined) },
    });

    const okRes = await proxy(mk(await tokenFor(0)));
    expect(okRes.headers.get('x-middleware-next')).toBe('1'); // allowed through

    const noCookie = await proxy(mk(undefined));
    expect(noCookie.status).toBe(307);
    expect(noCookie.headers.get('location')).toContain('/login');

    const bad = await proxy(mk('garbage'));
    expect(bad.status).toBe(307);

    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('the landing page uses the signature-only helper, not the DB-backed one', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(require('path').join(process.cwd(), 'app/page.tsx'), 'utf8');
    expect(src).toContain('getUnverifiedSession');
    expect(src).not.toMatch(/\bgetSession\b/);
    expect(src).not.toMatch(/@\/lib\/prisma/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Routes that were vulnerable through getSession() now reject stale tokens
// ═══════════════════════════════════════════════════════════════════════════

const P = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (route: string, method: string, url: string, body?: unknown, ctx?: unknown) => ({
  route, method, url, body, ctx,
});

const AFFECTED_ROUTES = [
  call('@/app/api/sessions/route', 'GET', '/api/sessions'),
  call('@/app/api/sessions/route', 'DELETE', '/api/sessions'),
  call('@/app/api/sessions/[id]/route', 'GET', '/api/sessions/s1', undefined, P('s1')),
  call('@/app/api/sessions/[id]/route', 'DELETE', '/api/sessions/s1', undefined, P('s1')),
  call('@/app/api/sessions/[id]/route', 'PATCH', '/api/sessions/s1', { pythonScript: 'x' }, P('s1')),
  call('@/app/api/sessions/[id]/share/route', 'POST', '/api/sessions/s1/share', {}, P('s1')),
  call('@/app/api/sessions/[id]/iterations/route', 'GET', '/api/sessions/s1/iterations', undefined, P('s1')),
  call('@/app/api/sessions/[id]/iterations/route', 'DELETE', '/api/sessions/s1/iterations?version=1', undefined, P('s1')),
  call('@/app/api/outputs/[...path]/route', 'GET', '/api/outputs/cad_s1.stl', undefined, { params: Promise.resolve({ path: ['cad_s1.stl'] }) }),
  call('@/app/api/blueprint/[id]/route', 'GET', '/api/blueprint/s1', undefined, P('s1')),
  call('@/app/api/assistant/compare/route', 'POST', '/api/assistant/compare', { message: 'hi' }),
  call('@/app/api/cam/analyze/route', 'POST', '/api/cam/analyze', { session_id: 's1', parameters: {} }),
  call('@/app/api/cam/auto-plan/route', 'POST', '/api/cam/auto-plan', { session_id: 's1', parameters: {} }),
  call('@/app/api/cam/toolpaths/route', 'POST', '/api/cam/toolpaths', { session_id: 's1' }),
  call('@/app/api/cam/gcode/route', 'POST', '/api/cam/gcode', { session_id: 's1' }),
  call('@/app/api/cam/recommend-machine/route', 'POST', '/api/cam/recommend-machine', { features: [] }),
  call('@/app/api/cam/[jobId]/simulate/prepare/route', 'POST', '/api/cam/s1/simulate/prepare', { setup: {}, operations: [] }, { params: Promise.resolve({ jobId: 's1' }) }),
];

describe('routes previously vulnerable via getSession() now reject a stale token', () => {
  beforeEach(() => {
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
    process.env.SERVICE_API_KEY = 'k';
    // The session row would be visible/owned by this user if authentication were (wrongly) accepted.
    mockCadSession.findUnique.mockResolvedValue({ userId: USER_ID, isShared: false });
    mockCadSession.findMany.mockResolvedValue([]);
    // sessions GET runs a disk scan before auth; keep it inert for the test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.spyOn(require('fs'), 'existsSync').mockReturnValue(false);
    // The 'valid token' control cases run route bodies against a minimal Prisma mock; their
    // internal error logging is expected and irrelevant to the assertion (status !== 401).
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(AFFECTED_ROUTES)('$method $url → 401 with stale token, no data access, no upstream call', async (r) => {
    cookieValue = await tokenFor(0);
    dbUser!.tokenVersion = 1; // reset approved after the token was issued
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const handler = require(r.route)[r.method];

    const init: RequestInit = { method: r.method, headers: { 'content-type': 'application/json' } };
    if (r.body !== undefined) init.body = JSON.stringify(r.body);
    const res = await handler(new Request(`http://localhost:3000${r.url}`, init), r.ctx);

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCadSession.update).not.toHaveBeenCalled();
    expect(mockCadSession.delete).not.toHaveBeenCalled();
    expect(mockCadSession.deleteMany).not.toHaveBeenCalled();
    expect(mockCadSession.create).not.toHaveBeenCalled();
  });

  it.each(AFFECTED_ROUTES)('$method $url → NOT 401 for a current token (control: auth still lets valid users in)', async (r) => {
    cookieValue = await tokenFor(0); // matches dbUser.tokenVersion = 0
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const handler = require(r.route)[r.method];

    const init: RequestInit = { method: r.method, headers: { 'content-type': 'application/json' } };
    if (r.body !== undefined) init.body = JSON.stringify(r.body);
    const res = await handler(new Request(`http://localhost:3000${r.url}`, init), r.ctx);

    expect(res.status).not.toBe(401);
  });

  it('anonymous-tolerant route: a stale token is treated as anonymous (shared allowed, private denied)', async () => {
    cookieValue = await tokenFor(0);
    dbUser!.tokenVersion = 1;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('@/app/api/sessions/[id]/route');

    mockCadSession.findUnique.mockResolvedValue({ id: 's1', userId: USER_ID, isShared: false });
    const privateRes = await GET(new Request('http://localhost:3000/api/sessions/s1'), P('s1'));
    expect(privateRes.status).toBe(401);

    mockCadSession.findUnique.mockResolvedValue({ id: 's1', userId: USER_ID, isShared: true });
    const sharedRes = await GET(new Request('http://localhost:3000/api/sessions/s1'), P('s1'));
    expect(sharedRes.status).toBe(200);
  });
});

describe('routes that already used requireSession/requireAdmin are still protected', () => {
  it('render and generate reject a stale token', async () => {
    cookieValue = await tokenFor(0);
    dbUser!.tokenVersion = 1;
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
    process.env.SERVICE_API_KEY = 'k';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const render = require('@/app/api/render/route').POST;
    const res = await render(new Request('http://localhost:3000/api/render', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ python_script: 'x', parameters: {} }),
    }));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
