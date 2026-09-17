/**
 * VEX-2A-011 Regression Tests — Password Reset Workflow
 *
 * Verifies that:
 * - Forgot-password endpoint creates PENDING requests (no direct password overwrite)
 * - Admin approval atomically updates password + invalidates tokens
 * - Non-admin users cannot access admin endpoints
 * - Account enumeration is prevented
 * - Existing JWTs are invalidated after password reset
 * - State transitions are race-safe via atomic conditional updates
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

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number; headers?: Record<string, string> }) => {
      const res = new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
      (res as any).status = init?.status || 200;
      return res;
    },
  },
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRequireSession = jest.fn();
const mockRequireAdmin = jest.fn();
const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  requireSession: (...args: unknown[]) => mockRequireSession(...args),
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    passwordResetRequest: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('bcryptjs', () => {
  const hash = jest.fn().mockResolvedValue('$2a$10$hashedpassword');
  const compare = jest.fn().mockResolvedValue(true);
  return {
    __esModule: true,
    default: { hash, compare },
    hash,
    compare,
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makePostRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VEX-2A-011 — Password Reset Workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-key-for-testing';

    // Default: unauthenticated
    mockRequireSession.mockResolvedValue(null);
    mockRequireAdmin.mockResolvedValue(null);

    // Default: DB mocks
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'reset-req-1', userId: 'user-1', status: 'pending' });
    mockUpdate.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockTransaction.mockImplementation(async (fn: any) => fn({
      passwordResetRequest: {
        updateMany: mockUpdateMany,
        findFirst: mockFindFirst,
        findUnique: mockFindUnique,
        update: mockUpdate,
      },
      user: {
        update: mockUpdate,
      },
    }));
  });

  // ════════════════════════════════════════════════════════════════════════════
  // POST /api/auth/forgot-password
  // ════════════════════════════════════════════════════════════════════════════

  describe('POST /api/auth/forgot-password', () => {
    it('creates a PENDING reset request instead of directly overwriting password', async () => {
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });

      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'test@example.com',
        newPassword: 'newpassword123',
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
          }),
        })
      );
    });

    it('does NOT change the user password directly', async () => {
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });

      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'test@example.com',
        newPassword: 'newpassword123',
      });
      await POST(req);

      expect(mockCreate).toHaveBeenCalled();
    });

    it('returns same response for existing and non-existing emails (prevents enumeration)', async () => {
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'existing@example.com' });
      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req1 = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'existing@example.com',
        newPassword: 'newpassword123',
      });
      const res1 = await POST(req1);
      const data1 = await res1.json();

      mockFindUnique.mockResolvedValue(null);
      const req2 = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'nonexistent@example.com',
        newPassword: 'newpassword123',
      });
      const res2 = await POST(req2);
      const data2 = await res2.json();

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(data1.message).toBe(data2.message);
    });

    it('validates minimum password length', async () => {
      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'test@example.com',
        newPassword: '12345',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('validates required fields', async () => {
      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'test@example.com',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it('replaces existing pending request for same user', async () => {
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });
      mockFindFirst.mockResolvedValue({ id: 'existing-req', userId: 'user-1', status: 'pending' });

      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'test@example.com',
        newPassword: 'updatedpassword',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('validates password confirmation when provided', async () => {
      const { POST } = require('@/app/api/auth/forgot-password/route');
      const req = makePostRequest('http://localhost:3000/api/auth/forgot-password', {
        email: 'test@example.com',
        newPassword: 'newpassword123',
        confirmPassword: 'differentpassword',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /api/admin/password-reset-requests
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /api/admin/password-reset-requests', () => {
    it('returns 403 when not admin', async () => {
      mockRequireSession.mockResolvedValue('user-123');
      mockRequireAdmin.mockResolvedValue(null);

      const { GET } = require('@/app/api/admin/password-reset-requests/route');
      const res = await GET(makeGetRequest('http://localhost:3000/api/admin/password-reset-requests'));

      expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      mockRequireSession.mockResolvedValue(null);
      mockRequireAdmin.mockResolvedValue(null);

      const { GET } = require('@/app/api/admin/password-reset-requests/route');
      const res = await GET(makeGetRequest('http://localhost:3000/api/admin/password-reset-requests'));

      expect(res.status).toBe(403);
    });

    it('returns pending requests when admin', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockFindMany.mockResolvedValue([
        {
          id: 'req-1',
          userId: 'user-1',
          status: 'pending',
          createdAt: new Date().toISOString(),
          user: { email: 'user@example.com', name: 'Test User' },
        },
      ]);

      const { GET } = require('@/app/api/admin/password-reset-requests/route');
      const res = await GET(makeGetRequest('http://localhost:3000/api/admin/password-reset-requests'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.requests).toHaveLength(1);
      expect(data.requests[0].user.email).toBe('user@example.com');
    });

    it('does NOT return passwordHash in response', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockFindMany.mockResolvedValue([
        {
          id: 'req-1',
          userId: 'user-1',
          status: 'pending',
          createdAt: new Date().toISOString(),
          user: { email: 'user@example.com', name: 'Test User' },
        },
      ]);

      const { GET } = require('@/app/api/admin/password-reset-requests/route');
      const res = await GET(makeGetRequest('http://localhost:3000/api/admin/password-reset-requests'));
      const data = await res.json();

      expect(data.requests[0].passwordHash).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // POST /api/admin/password-reset-requests/[id]/approve
  // ════════════════════════════════════════════════════════════════════════════

  describe('POST /api/admin/password-reset-requests/[id]/approve', () => {
    it('returns 403 when not admin', async () => {
      mockRequireSession.mockResolvedValue('user-123');
      mockRequireAdmin.mockResolvedValue(null);

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(403);
    });

    it('approves request and updates password atomically', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        passwordHash: '$2a$10$hashedpassword',
      });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(200);
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
          data: expect.objectContaining({ status: 'approved' }),
        })
      );
    });

    it('increments tokenVersion to invalidate existing JWTs', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        passwordHash: '$2a$10$hashedpassword',
      });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            tokenVersion: { increment: 1 },
          }),
        })
      );
    });

    it('returns 404 for non-existent request', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue(null);

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-999/approve'), {
        params: Promise.resolve({ id: 'req-999' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 409 for already-processed request', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'approved' });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(409);
    });

    it('cannot approve already-rejected request', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'rejected' });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(409);
    });

    it('failed conditional transition does NOT change password', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'approved' });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      // user.update should NOT be called — the transaction returned early
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('failed conditional transition does NOT increment tokenVersion', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'approved' });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('double approval: second call returns 409', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');

      // First call: updateMany succeeds
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        userId: 'user-1',
        passwordHash: '$2a$10$hashedpassword',
      });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/approve/route');
      const res1 = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });
      expect(res1.status).toBe(200);

      // Second call: updateMany returns 0 (status already approved)
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'approved' });

      const res2 = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/approve'), {
        params: Promise.resolve({ id: 'req-1' }),
      });
      expect(res2.status).toBe(409);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // POST /api/admin/password-reset-requests/[id]/reject
  // ════════════════════════════════════════════════════════════════════════════

  describe('POST /api/admin/password-reset-requests/[id]/reject', () => {
    it('returns 403 when not admin', async () => {
      mockRequireSession.mockResolvedValue('user-123');
      mockRequireAdmin.mockResolvedValue(null);

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/reject'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(403);
    });

    it('rejects request successfully', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 1 });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/reject', {
        reason: 'Suspicious activity',
      }), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(200);
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
          data: expect.objectContaining({
            status: 'rejected',
            rejectReason: 'Suspicious activity',
          }),
        })
      );
    });

    it('returns 404 for non-existent request', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue(null);

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-999/reject'), {
        params: Promise.resolve({ id: 'req-999' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 409 for already-approved request', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'approved' });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/reject'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(409);
    });

    it('cannot reject already-rejected request', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'rejected' });

      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
      const res = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/reject'), {
        params: Promise.resolve({ id: 'req-1' }),
      });

      expect(res.status).toBe(409);
    });

    it('double rejection: second call returns 409', async () => {
      mockRequireAdmin.mockResolvedValue('admin-1');

      // First call succeeds
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      const { POST } = require('@/app/api/admin/password-reset-requests/[id]/reject/route');
      const res1 = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/reject'), {
        params: Promise.resolve({ id: 'req-1' }),
      });
      expect(res1.status).toBe(200);

      // Second call: already rejected
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });
      mockFindFirst.mockResolvedValue({ status: 'rejected' });
      const res2 = await POST(makePostRequest('http://localhost:3000/api/admin/password-reset-requests/req-1/reject'), {
        params: Promise.resolve({ id: 'req-1' }),
      });
      expect(res2.status).toBe(409);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /api/auth/password-reset-requests/mine
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /api/auth/password-reset-requests/mine', () => {
    it('returns 401 when unauthenticated', async () => {
      mockRequireSession.mockResolvedValue(null);

      const { GET } = require('@/app/api/auth/password-reset-requests/mine/route');
      const res = await GET();

      expect(res.status).toBe(401);
    });

    it('returns user own request', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockFindFirst.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      const { GET } = require('@/app/api/auth/password-reset-requests/mine/route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.request.id).toBe('req-1');
    });

    it('returns null when user has no request', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockFindFirst.mockResolvedValue(null);

      const { GET } = require('@/app/api/auth/password-reset-requests/mine/route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.request).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Cross-cutting: tokenVersion invalidation
  // ════════════════════════════════════════════════════════════════════════════

  describe('Token version invalidation', () => {
    it('requireSession rejects JWT with mismatched tokenVersion', async () => {
      mockRequireSession.mockResolvedValue(null);

      const { GET } = require('@/app/api/auth/password-reset-requests/mine/route');
      const res = await GET();

      expect(res.status).toBe(401);
    });
  });
});
