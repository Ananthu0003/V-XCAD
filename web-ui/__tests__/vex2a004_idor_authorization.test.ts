/**
 * VEX-2A-004 Regression Tests — Blueprint & Output IDOR Authorization
 *
 * Verifies that:
 * 1. Authenticated owner can access their own blueprint
 * 2. Authenticated non-owner is denied access to another user's blueprint (403)
 * 3. Shared session blueprint is accessible to other authenticated users
 * 4. Missing session returns 404
 * 5. Authenticated owner can access their own output artifacts
 * 6. Authenticated non-owner is denied access to another user's output artifacts (403)
 * 7. Path traversal remains blocked
 * 8. Non-session-derived output files are denied (VEX-NEW-02)
 * 9. Orphaned files (session deleted from DB) are denied (VEX-NEW-01)
 */

// Polyfill Request/Response/Headers BEFORE any imports
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

const mockFindUnique = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    cadSession: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const mockReadFile = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

const AUTH_USER = { userId: 'user-owner', email: 'owner@test.com' };

const OWN_SESSION = { userId: 'user-owner', isShared: false };
const OTHER_SESSION = { userId: 'user-other', isShared: false };
const SHARED_SESSION = { userId: 'user-other', isShared: true };
const NULL_USER_SESSION = { userId: null, isShared: false };

function makeBlueprintResponse() {
  const res = new Response(Buffer.from([0x89, 0x50, 0x4E, 0x47]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  // Ensure blob() exists for tests
  (res as any).blob = async () => new Blob([Buffer.from([0x89, 0x50, 0x4E, 0x47])]);
  return res;
}

// ── Blueprint Route Tests ──────────────────────────────────────────────────

describe('VEX-2A-004 — /api/blueprint/[id] authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
    mockGetSession.mockResolvedValue(AUTH_USER);
  });

  it('allows owner to access their own blueprint', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate user check
      .mockResolvedValueOnce(OWN_SESSION); // ownership check

    mockFetch.mockResolvedValue(makeBlueprintResponse());

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/session-abc');
    const res = await GET(req, { params: Promise.resolve({ id: 'session-abc' }) });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/blueprint/session-abc');
  });

  it('denies access to another user\'s private blueprint (403)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(OTHER_SESSION); // not owner, not shared

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/other-session');
    const res = await GET(req, { params: Promise.resolve({ id: 'other-session' }) });

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows access to shared session blueprint', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(SHARED_SESSION); // shared

    mockFetch.mockResolvedValue(makeBlueprintResponse());

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/shared-session');
    const res = await GET(req, { params: Promise.resolve({ id: 'shared-session' }) });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for missing session', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(null); // session not found

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/nonexistent');
    const res = await GET(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies access to null-user session from authenticated user', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(NULL_USER_SESSION); // null user

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/anon-session');
    const res = await GET(req, { params: Promise.resolve({ id: 'anon-session' }) });

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/any-session');
    const res = await GET(req, { params: Promise.resolve({ id: 'any-session' }) });

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call ai-engine when authorization fails', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' })
      .mockResolvedValueOnce(OTHER_SESSION);

    const { GET } = require('@/app/api/blueprint/[id]/route');
    const req = makeGetRequest('http://localhost:3000/api/blueprint/other-session');
    await GET(req, { params: Promise.resolve({ id: 'other-session' }) });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Outputs Route Tests ────────────────────────────────────────────────────

describe('VEX-2A-004 — /api/outputs/[...path] authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockFindUnique.mockResolvedValue({ id: 'user-owner' }); // user lookup for auth gate
    mockReadFile.mockResolvedValue(Buffer.from('file-content'));
  });

  it('allows owner to access their own output artifact', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(OWN_SESSION); // ownership check

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_session-abc.stl');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_session-abc.stl'] }) });

    expect(res.status).toBe(200);
  });

  it('denies access to another user\'s output artifact (403)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(OTHER_SESSION); // not owner, not shared

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_other-session.stl');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_other-session.stl'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('allows access to shared session output artifact', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(SHARED_SESSION); // shared

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_shared-session.step');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_shared-session.step'] }) });

    expect(res.status).toBe(200);
  });

  it('denies access to null-user session output artifact', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(NULL_USER_SESSION); // null user

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_anon-session.stl');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_anon-session.stl'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('denies non-session-derived files (VEX-NEW-02)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }); // auth gate only

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/random-file.txt');
    const res = await GET(req, { params: Promise.resolve({ path: ['random-file.txt'] }) });

    expect(res.status).toBe(403);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('blocks path traversal', async () => {
    mockGetSession.mockResolvedValue(AUTH_USER);
    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/..%2F..%2Fetc%2Fpasswd');
    const res = await GET(req, { params: Promise.resolve({ path: ['../etc/passwd'] }) });

    expect(res.status).toBe(400);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_session.stl');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_session.stl'] }) });

    expect(res.status).toBe(401);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('handles versioned filenames correctly', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(OWN_SESSION); // ownership check

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_session-abc_v2.step');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_session-abc_v2.step'] }) });

    expect(res.status).toBe(200);
  });

  it('denies orphaned files (session deleted from DB, VEX-NEW-01)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-owner' }) // auth gate
      .mockResolvedValueOnce(null); // session not in DB (orphaned)

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_orphan.stl');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_orphan.stl'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
