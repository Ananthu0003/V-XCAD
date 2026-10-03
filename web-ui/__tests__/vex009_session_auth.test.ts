/**
 * VEX-009 Regression Tests — Session Ownership / Null-User Authorization
 *
 * Verifies explicit ownership/shared semantics for CadSession resources:
 *
 * GET /api/sessions/[id]:
 *   - Authenticated owner → 200
 *   - Authenticated non-owner, private → 403
 *   - Authenticated reader, shared session → 200
 *   - Null-user session → 403 (authenticated) / 401 (unauthenticated)
 *   - Unauthenticated, non-shared → 401
 *   - Missing session → 404
 *
 * PATCH /api/sessions/[id]:
 *   - Owner → 200
 *   - Non-owner, private → 403
 *   - Non-owner, shared → 403
 *   - Null-user → 403
 *   - Unauthenticated → 401
 *
 * GET /api/sessions/[id]/iterations:
 *   - Owner → 200
 *   - Non-owner, private → 403
 *   - Reader, shared → 200
 *   - Null-user → 403 (authenticated) / 401 (unauthenticated)
 *   - Unauthenticated, non-shared → 401
 *
 * GET /api/sessions (list):
 *   - Authenticated → 200, contains own sessions + shared sessions
 *   - Does NOT contain null-user sessions
 *   - Unauthenticated → 401
 *
 * PATCH does NOT accidentally allow shared-session write.
 * GET does NOT accidentally deny shared-session read.
 */

// ── Polyfill Request/Response/Headers ──────────────────────────────────────

if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(public url: string, public init?: RequestInit) {
      this.headers = new Headers(init?.headers);
      this.method = init?.method || 'GET';
      this.body = init?.body || null;
      this.nextUrl = new URL(url);
    }
    headers: Headers;
    method: string;
    body: string | null;
    nextUrl: URL;
    async json() { return JSON.parse(this.body as string); }
    async text() { return this.body as string; }
    clone() { return new Request(this.url, { method: this.method, headers: this.headers as any, body: this.body as any }); }
  };
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(public body?: BodyInit | null, public init?: ResponseInit) {
      this.status = init?.status || 200;
      this.headers = new Headers(init?.headers);
      this.ok = this.status >= 200 && this.status < 300;
    }
    status: number;
    headers: Headers;
    ok: boolean;
    async json() { return JSON.parse(this.body as string); }
    async text() { return this.body as string; }
    static json(data: any, init?: ResponseInit) {
      return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
    }
  };
}

if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    private map = new Map<string, string>();
    constructor(init?: HeadersInit) {
      if (init) {
        if (Array.isArray(init)) {
          init.forEach(([k, v]) => this.map.set(k.toLowerCase(), v));
        } else if (typeof init === 'object') {
          Object.entries(init).forEach(([k, v]) => this.map.set(k.toLowerCase(), v as string));
        }
      }
    }
    get(name: string) { return this.map.get(name.toLowerCase()) || null; }
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
    has(name: string) { return this.map.has(name.toLowerCase()); }
    delete(name: string) { return this.map.delete(name.toLowerCase()); }
    append(name: string, value: string) { this.set(name, (this.get(name) || '') + ', ' + value); }
    forEach(callback: (value: string, key: string) => void) { this.map.forEach(callback); }
    keys() { return this.map.keys(); }
    values() { return this.map.values(); }
    entries() { return this.map.entries(); }
    [Symbol.iterator]() { return this.map.entries(); }
  };
}

// ── Mock next/server ──────────────────────────────────────────────────────

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
    }
    static json(data: any, init?: { status?: number; headers?: Record<string, string> }) {
      const res = new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
      (res as any).status = init?.status || 200;
      return res;
    }
  }
  return { NextResponse: MockNextResponse };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockCadSessionFindUnique = jest.fn();
const mockCadSessionFindMany = jest.fn();
const mockCadSessionUpdate = jest.fn();
const mockCadIterationGroupBy = jest.fn();
const mockCadIterationFindMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
      findMany: (...args: unknown[]) => mockCadSessionFindMany(...args),
      update: (...args: unknown[]) => mockCadSessionUpdate(...args),
    },
    cadIteration: {
      groupBy: (...args: unknown[]) => mockCadIterationGroupBy(...args),
      findMany: (...args: unknown[]) => mockCadIterationFindMany(...args),
    },
  },
}));

const mockExistsSync = jest.fn().mockReturnValue(false);
const mockReaddirSync = jest.fn().mockReturnValue([]);
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: jest.fn().mockReturnValue(''),
  statSync: jest.fn().mockReturnValue({ mtime: new Date() }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

function makePatchRequest(url: string, body: any): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const AUTH_USER = { userId: 'user-owner', email: 'owner@test.com' };

const OWN_SESSION = { id: 'sess-own', userId: 'user-owner', isShared: false };
const OTHER_PRIVATE = { id: 'sess-other', userId: 'user-other', isShared: false };
const SHARED_SESSION = { id: 'sess-shared', userId: 'user-other', isShared: true };
const NULL_USER_SESSION = { id: 'sess-null', userId: null, isShared: false };

// ════════════════════════════════════════════════════════════════════════════
// GET /api/sessions/[id]
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-009 — GET /api/sessions/[id] authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
  });

  it('allows owner to read their own session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(OWN_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-own');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-own' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('sess-own');
  });

  it('denies non-owner from reading private session (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue(OTHER_PRIVATE);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-other');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-other' }) });

    expect(res.status).toBe(403);
  });

  it('allows authenticated reader to access shared session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(SHARED_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-shared');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-shared' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('sess-shared');
  });

  it('denies authenticated user from reading null-user session (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue(NULL_USER_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-null');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-null' }) });

    expect(res.status).toBe(403);
  });

  it('allows unauthenticated reader to access shared session (share page)', async () => {
    mockGetSession.mockResolvedValue(null);
    mockCadSessionFindUnique.mockResolvedValue(SHARED_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-shared');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-shared' }) });

    expect(res.status).toBe(200);
  });

  it('returns 401 for unauthenticated access to non-shared session', async () => {
    mockGetSession.mockResolvedValue(null);
    mockCadSessionFindUnique.mockResolvedValue(OTHER_PRIVATE);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-other');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-other' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 for missing session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const { GET } = require('@/app/api/sessions/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/nonexistent');
    const res = await GET(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/sessions/[id]
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-009 — PATCH /api/sessions/[id] authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadSessionUpdate.mockResolvedValue({ id: 'sess-own', prompt: 'updated' });
  });

  it('allows owner to modify their own session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-own', userId: 'user-owner' });

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-own', { prompt: 'updated' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sess-own' }) });

    expect(res.status).toBe(200);
    expect(mockCadSessionUpdate).toHaveBeenCalled();
  });

  it('denies non-owner from modifying private session (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-other', userId: 'user-other' });

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-other', { prompt: 'hacked' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sess-other' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });

  it('denies non-owner from modifying shared session (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-shared', userId: 'user-other' });

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-shared', { prompt: 'hacked' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sess-shared' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });

  it('denies modification of null-user session (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-null', userId: null });

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-null', { prompt: 'hijacked' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sess-null' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 for unauthenticated PATCH', async () => {
    mockGetSession.mockResolvedValue(null);

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-own', { prompt: 'test' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sess-own' }) });

    expect(res.status).toBe(401);
    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for missing session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/nonexistent', { prompt: 'test' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });

  it('auth gate runs before database lookup', async () => {
    mockGetSession.mockResolvedValue(null);

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-own', { prompt: 'test' });
    await PATCH(req, { params: Promise.resolve({ id: 'sess-own' }) });

    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/sessions/[id]/iterations
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-009 — GET /api/sessions/[id]/iterations authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadIterationFindMany.mockResolvedValue([]);
  });

  it('allows owner to read their own iterations', async () => {
    mockCadSessionFindUnique.mockResolvedValue(OWN_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-own/iterations');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-own' }) });

    expect(res.status).toBe(200);
  });

  it('denies non-owner from reading private iterations (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue(OTHER_PRIVATE);

    const { GET } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-other/iterations');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-other' }) });

    expect(res.status).toBe(403);
  });

  it('allows reader to access shared session iterations', async () => {
    mockCadSessionFindUnique.mockResolvedValue(SHARED_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-shared/iterations');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-shared' }) });

    expect(res.status).toBe(200);
  });

  it('denies authenticated user from reading null-user iterations (403)', async () => {
    mockCadSessionFindUnique.mockResolvedValue(NULL_USER_SESSION);

    const { GET } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-null/iterations');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-null' }) });

    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated access to non-shared iterations', async () => {
    mockGetSession.mockResolvedValue(null);
    mockCadSessionFindUnique.mockResolvedValue(OTHER_PRIVATE);

    const { GET } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/sess-other/iterations');
    const res = await GET(req, { params: Promise.resolve({ id: 'sess-other' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 for missing session iterations', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const { GET } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions/nonexistent/iterations');
    const res = await GET(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/sessions (list)
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-009 — GET /api/sessions list authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadIterationGroupBy.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  it('returns authenticated user\'s sessions and shared sessions', async () => {
    mockCadSessionFindMany.mockResolvedValue([OWN_SESSION, SHARED_SESSION]);

    const { GET } = require('@/app/api/sessions/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions');
    const res = await GET();

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('query excludes null-user sessions', async () => {
    mockCadSessionFindMany.mockResolvedValue([OWN_SESSION]);

    const { GET } = require('@/app/api/sessions/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions');
    await GET();

    const call = mockCadSessionFindMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { userId: 'user-owner' },
      { isShared: true }
    ]);
    // Must NOT contain { userId: null }
    expect(JSON.stringify(call.where)).not.toContain('"userId":null');
  });

  it('returns 401 for unauthenticated list', async () => {
    mockGetSession.mockResolvedValue(null);

    const { GET } = require('@/app/api/sessions/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions');
    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockCadSessionFindMany).not.toHaveBeenCalled();
  });

  it('auth gate runs before database query', async () => {
    mockGetSession.mockResolvedValue(null);

    const { GET } = require('@/app/api/sessions/route');
    const req = makeGetRequest('http://localhost:3000/api/sessions');
    await GET();

    expect(mockCadSessionFindMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cross-cutting: PATCH must not allow shared write
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-009 — PATCH shared session is denied (write != read)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
  });

  it('non-owner cannot PATCH a shared session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-shared', userId: 'user-other' });

    const { PATCH } = require('@/app/api/sessions/[id]/route');
    const req = makePatchRequest('http://localhost:3000/api/sessions/sess-shared', { prompt: 'hacked' });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sess-shared' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });
});
