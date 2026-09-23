/**
 * @jest-environment node
 *
 * GET /api/sessions — authentication must run BEFORE autoSyncDiskSessions().
 *
 * The original ordering called autoSyncDiskSessions() (filesystem read + potential
 * cadSession.create() writes) before checking the caller's session, so an unauthenticated
 * request could trigger real disk I/O and database writes before being rejected with 401.
 * This suite proves the fix by asserting on the underlying fs/Prisma calls directly — not just
 * the final HTTP status — so it genuinely distinguishes the old ordering from the new one.
 */

if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(public url: string, public init?: RequestInit) {
      this.headers = new Headers(init?.headers);
      this.method = init?.method || 'GET';
    }
    headers: Headers;
    method: string;
  };
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(public body?: BodyInit | null, public init?: ResponseInit) {
      this.status = init?.status || 200;
      this.headers = new Headers(init?.headers);
    }
    status: number;
    headers: Headers;
    async json() { return JSON.parse(this.body as string); }
  };
}

if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    private map = new Map<string, string>();
    get(name: string) { return this.map.get(name.toLowerCase()) || null; }
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
  };
}

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(data: any, init?: { status?: number }) {
      return new Response(JSON.stringify(data), { status: init?.status || 200 });
    }
  }
  return { NextResponse: MockNextResponse };
});

const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockCadSessionFindUnique = jest.fn();
const mockCadSessionFindMany = jest.fn();
const mockCadSessionCreate = jest.fn();
const mockCadIterationGroupBy = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
      findMany: (...args: unknown[]) => mockCadSessionFindMany(...args),
      create: (...args: unknown[]) => mockCadSessionCreate(...args),
    },
    cadIteration: {
      groupBy: (...args: unknown[]) => mockCadIterationGroupBy(...args),
    },
  },
}));

const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockStatSync = jest.fn();
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

const AUTH_USER = { userId: 'user-1', email: 'user@test.com' };

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  // The outputs directory exists and has a real, syncable script — so any of these calls
  // firing at all (for the unauthenticated case) is unambiguous, genuine evidence of a
  // pre-auth side effect, not a false negative from an empty/absent directory.
  mockExistsSync.mockReturnValue(true);
  mockReaddirSync.mockReturnValue(['cad_some-session.py']);
  mockReadFileSync.mockReturnValue('PARAMETERS = {}\n');
  mockStatSync.mockReturnValue({ mtime: new Date('2026-01-01') });
  mockCadSessionFindUnique.mockResolvedValue(null);
  mockCadSessionCreate.mockResolvedValue({});
  mockCadSessionFindMany.mockResolvedValue([]);
  mockCadIterationGroupBy.mockResolvedValue([]);
});

describe('GET /api/sessions — auth runs before autoSyncDiskSessions()', () => {
  it('unauthenticated request: rejects with 401 and performs NO filesystem access at all', async () => {
    mockGetSession.mockResolvedValue(null);

    const { GET } = require('@/app/api/sessions/route');
    const res = await GET();

    expect(res.status).toBe(401);
    // The decisive assertions: under the OLD ordering, autoSyncDiskSessions() ran first and
    // these would all have been called even though the request was ultimately rejected.
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockCadSessionCreate).not.toHaveBeenCalled();
  });

  it('unauthenticated request with no userId on the session object: same — rejects before any sync', async () => {
    mockGetSession.mockResolvedValue({});

    const { GET } = require('@/app/api/sessions/route');
    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockCadSessionCreate).not.toHaveBeenCalled();
  });

  it('getSession() is called before any fs/Prisma-write call in the same invocation (ordering, not just gating)', async () => {
    mockGetSession.mockResolvedValue(null);
    const callOrder: string[] = [];
    mockGetSession.mockImplementation(async () => { callOrder.push('getSession'); return null; });
    mockExistsSync.mockImplementation(() => { callOrder.push('existsSync'); return true; });

    const { GET } = require('@/app/api/sessions/route');
    await GET();

    expect(callOrder).toEqual(['getSession']); // existsSync must never have run
  });

  it('authenticated request: still performs disk synchronization and imports a new orphaned script', async () => {
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadSessionFindMany.mockResolvedValue([]);

    const { GET } = require('@/app/api/sessions/route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockExistsSync).toHaveBeenCalledWith('/app/outputs');
    expect(mockReaddirSync).toHaveBeenCalledWith('/app/outputs');
    expect(mockCadSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockCadSessionCreate.mock.calls[0][0].data.id).toBe('some-session');
  });

  it('authenticated request: returns the expected shape (own + shared sessions) after sync runs', async () => {
    mockGetSession.mockResolvedValue(AUTH_USER);
    const OWN = { id: 'own-1', userId: 'user-1', isShared: false };
    const SHARED = { id: 'shared-1', userId: 'someone-else', isShared: true };
    mockCadSessionFindMany.mockResolvedValue([OWN, SHARED]);

    const { GET } = require('@/app/api/sessions/route');
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((s: any) => s.id).sort()).toEqual(['own-1', 'shared-1']);

    // Sync happened BEFORE the sessions query, but the query itself is unaffected —
    // ownership/sharing semantics (VEX-009) are unchanged by the reordering.
    const call = mockCadSessionFindMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([{ userId: 'user-1' }, { isShared: true }]);
  });

  it('authenticated request: sync failure does not crash the route (existing try/catch inside autoSyncDiskSessions preserved)', async () => {
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockExistsSync.mockImplementation(() => { throw new Error('disk error'); });
    mockCadSessionFindMany.mockResolvedValue([]);

    const { GET } = require('@/app/api/sessions/route');
    const res = await GET();

    // autoSyncDiskSessions() has its own internal try/catch (console.warn + swallow); the
    // route must still succeed and return the caller's sessions.
    expect(res.status).toBe(200);
  });
});
