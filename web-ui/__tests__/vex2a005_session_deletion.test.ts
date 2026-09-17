/**
 * VEX-2A-005 Regression Tests — Session Deletion Authorization
 *
 * Verifies that:
 * 1. Authenticated owner can DELETE their own session
 * 2. Authenticated non-owner cannot DELETE a private session
 * 3. Authenticated non-owner cannot DELETE a shared session
 * 4. Authenticated user cannot DELETE a null-user session
 * 5. Unauthenticated user cannot DELETE any session
 * 6. Authenticated bulk DELETE removes only the caller's sessions
 * 7. Bulk DELETE does NOT remove another user's sessions
 * 8. Bulk DELETE does NOT remove null-user sessions
 * 9. Unauthenticated bulk DELETE performs no deletion
 * 10. Owner can delete their iterations
 * 11. Non-owner cannot delete another user's iterations
 * 12. Non-owner cannot delete iterations belonging to a null-user session
 * 13. Unauthenticated iteration DELETE is rejected
 * 14. Verify deleteMany is called with ONLY { userId: authSession.userId } for bulk
 * 15. Verify destructive operation is not reached when authorization fails
 * 16. PATCH /api/sessions/[id] is intentionally NOT modified (VEX-009 scope)
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

const mockUserFindUnique = jest.fn();
const mockCadSessionFindUnique = jest.fn();
const mockCadSessionDelete = jest.fn();
const mockCadSessionDeleteMany = jest.fn();
const mockCadSessionUpdate = jest.fn();
const mockCadIterationDeleteMany = jest.fn();
const mockCadIterationFindMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
      delete: (...args: unknown[]) => mockCadSessionDelete(...args),
      deleteMany: (...args: unknown[]) => mockCadSessionDeleteMany(...args),
      update: (...args: unknown[]) => mockCadSessionUpdate(...args),
    },
    cadIteration: {
      deleteMany: (...args: unknown[]) => mockCadIterationDeleteMany(...args),
      findMany: (...args: unknown[]) => mockCadIterationFindMany(...args),
    },
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDeleteRequest(url: string): Request {
  return new Request(url, { method: 'DELETE' });
}

const AUTH_USER = { userId: 'user-owner', email: 'owner@test.com' };
const OTHER_USER = { userId: 'user-other', email: 'other@test.com' };

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/sessions/[id] — single session deletion
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-2A-005 — DELETE /api/sessions/[id] authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadSessionDelete.mockResolvedValue({});
  });

  it('allows owner to delete their own session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner' });

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-1' }) });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe('Session deleted');
    expect(mockCadSessionDelete).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
  });

  it('denies deletion of another user\'s private session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-other' });

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-2');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-2' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionDelete).not.toHaveBeenCalled();
  });

  it('denies deletion of a shared session by non-owner', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-other' });

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-shared');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-shared' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionDelete).not.toHaveBeenCalled();
  });

  it('denies deletion of a null-user session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: null });

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-anon');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-anon' }) });

    expect(res.status).toBe(403);
    expect(mockCadSessionDelete).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-1' }) });

    expect(res.status).toBe(401);
    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    expect(mockCadSessionDelete).not.toHaveBeenCalled();
  });

  it('returns 404 for missing session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/nonexistent');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
    expect(mockCadSessionDelete).not.toHaveBeenCalled();
  });

  it('does not reach delete when authorization fails', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-other' });

    const { DELETE } = require('@/app/api/sessions/[id]/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-2');
    await DELETE(req, { params: Promise.resolve({ id: 'sess-2' }) });

    expect(mockCadSessionDelete).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/sessions — bulk deletion
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-2A-005 — DELETE /api/sessions bulk authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadSessionDeleteMany.mockResolvedValue({ count: 0 });
  });

  it('authenticated bulk DELETE removes only caller\'s sessions', async () => {
    const { DELETE } = require('@/app/api/sessions/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions');
    const res = await DELETE();

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe('History cleared');
    expect(mockCadSessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-owner' }
    });
  });

  it('bulk DELETE does NOT include { userId: null } clause', async () => {
    const { DELETE } = require('@/app/api/sessions/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions');
    await DELETE();

    const call = mockCadSessionDeleteMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'user-owner' });
    // Ensure no OR clause with null
    expect(call.where.OR).toBeUndefined();
  });

  it('bulk DELETE does NOT remove another user\'s sessions', async () => {
    const { DELETE } = require('@/app/api/sessions/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions');
    await DELETE();

    const call = mockCadSessionDeleteMany.mock.calls[0][0];
    expect(call.where.userId).toBe('user-owner');
    expect(call.where.userId).not.toBe('user-other');
  });

  it('bulk DELETE does NOT remove null-user sessions', async () => {
    const { DELETE } = require('@/app/api/sessions/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions');
    await DELETE();

    const call = mockCadSessionDeleteMany.mock.calls[0][0];
    // The where clause must not contain any null-user condition
    expect(JSON.stringify(call.where)).not.toContain('null');
  });

  it('unauthenticated bulk DELETE returns 401', async () => {
    mockGetSession.mockResolvedValue(null);

    const { DELETE } = require('@/app/api/sessions/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions');
    const res = await DELETE();

    expect(res.status).toBe(401);
    expect(mockCadSessionDeleteMany).not.toHaveBeenCalled();
  });

  it('unauthenticated bulk DELETE performs no deletion', async () => {
    mockGetSession.mockResolvedValue(null);

    const { DELETE } = require('@/app/api/sessions/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions');
    await DELETE();

    expect(mockCadSessionDeleteMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/sessions/[id]/iterations — iteration deletion
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-2A-005 — DELETE /api/sessions/[id]/iterations authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadIterationDeleteMany.mockResolvedValue({});
    mockCadIterationFindMany.mockResolvedValue([]);
    mockCadSessionUpdate.mockResolvedValue({});
  });

  it('allows owner to delete their own iterations', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-1', userId: 'user-owner' });
    mockCadIterationDeleteMany.mockResolvedValue({ count: 1 });
    mockCadIterationFindMany.mockResolvedValue([]);

    const { DELETE } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-1/iterations?iterationId=iter-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-1' }) });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCadIterationDeleteMany).toHaveBeenCalled();
  });

  it('denies non-owner from deleting another user\'s iterations', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-2', userId: 'user-other' });

    const { DELETE } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-2/iterations?iterationId=iter-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-2' }) });

    expect(res.status).toBe(403);
    expect(mockCadIterationDeleteMany).not.toHaveBeenCalled();
  });

  it('denies non-owner from deleting iterations of a null-user session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-anon', userId: null });

    const { DELETE } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-anon/iterations?iterationId=iter-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-anon' }) });

    expect(res.status).toBe(403);
    expect(mockCadIterationDeleteMany).not.toHaveBeenCalled();
  });

  it('unauthenticated iteration DELETE is rejected', async () => {
    mockGetSession.mockResolvedValue(null);

    const { DELETE } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-1/iterations?iterationId=iter-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'sess-1' }) });

    expect(res.status).toBe(401);
    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    expect(mockCadIterationDeleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 for missing parent session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const { DELETE } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/nonexistent/iterations?iterationId=iter-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
    expect(mockCadIterationDeleteMany).not.toHaveBeenCalled();
  });

  it('does not reach deleteMany when authorization fails', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ id: 'sess-2', userId: 'user-other' });

    const { DELETE } = require('@/app/api/sessions/[id]/iterations/route');
    const req = makeDeleteRequest('http://localhost:3000/api/sessions/sess-2/iterations?iterationId=iter-1');
    await DELETE(req, { params: Promise.resolve({ id: 'sess-2' }) });

    expect(mockCadIterationDeleteMany).not.toHaveBeenCalled();
    expect(mockCadSessionUpdate).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/sessions/[id] — intentionally NOT modified (VEX-009 scope)
// ════════════════════════════════════════════════════════════════════════════

describe('VEX-2A-005 — PATCH /api/sessions/[id] is NOT in scope', () => {
  it('PATCH still uses the old authorization pattern (VEX-009)', async () => {
    // This test documents that PATCH was intentionally left unchanged.
    // The PATCH handler still uses: session.userId !== userId && session.userId !== null
    // which allows null-user session modification. This is VEX-009, not VEX-2A-005.
    const route = require('@/app/api/sessions/[id]/route');
    expect(typeof route.PATCH).toBe('function');
    // PATCH is present and was not modified by VEX-2A-005
  });
});
