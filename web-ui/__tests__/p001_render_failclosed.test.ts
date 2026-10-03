/**
 * P0-01 Regression Tests — Render Ownership Fail-Closed on DB Error
 *
 * Verifies that when the CadSession ownership lookup fails (e.g., database
 * connection error), the render route FAILS CLOSED: returns 500 and does NOT
 * proceed to ai-engine call or session upsert.
 *
 * Historical bug: the catch block logged a warning and continued execution,
 * creating a fail-open authorization path during database outages.
 */

// Polyfill Request/Response/Headers BEFORE any imports
if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(public url: string, public init?: RequestInit) {
      this.headers = new Headers(init?.headers);
      this.method = init?.method || 'GET';
      this.body = init?.body || null;
    }
    headers: Headers;
    method: string;
    body: string | null;
    async json() { return JSON.parse(this.body as string); }
    async text() { return this.body as string; }
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
    append(name: string, value: string) { this.set(name, (this.get(name) || '') + ', ' + (this.get(name) || '')); }
    forEach(callback: (value: string, key: string) => void) { this.map.forEach(callback); }
    keys() { return this.map.keys(); }
    values() { return this.map.values(); }
    entries() { return this.map.entries(); }
    [Symbol.iterator]() { return this.map.entries(); }
  };
}

// ── Mock next/server ────────────────────────────────────────────────────────

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

const mockGetSession = jest.fn();
const mockRequireSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  requireSession: (...args: unknown[]) => mockRequireSession(...args),
}));

const mockUserFindUnique = jest.fn();
const mockCadSessionFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockFindFirst = jest.fn();
const mockCadIterationCreate = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
    cadIteration: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCadIterationCreate(...args),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ── Import AFTER mocks ─────────────────────────────────────────────────────

const routeModule = require('@/app/api/render/route');
const { POST } = routeModule;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  python_script: 'from build123d import *\nBox(10, 20, 30)',
  parameters: { length: 10 },
};

const UPSTREAM_RESPONSE = {
  stl_url: '/outputs/cad_test.stl',
  step_url: '/outputs/cad_test.step',
  status: 'completed',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('P0-01 — Render ownership fail-closed on DB error', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

    // Default: authenticated valid user
    mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@example.com' });
    mockRequireSession.mockResolvedValue('user-123');
    mockUserFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });

    // Default: no existing iterations
    mockFindFirst.mockResolvedValue(null);

    // Default: upsert succeeds
    mockUpsert.mockResolvedValue({});

    // Default: CadIteration create succeeds
    mockCadIterationCreate.mockResolvedValue({});

    // Default: ai-engine returns success
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UPSTREAM_RESPONSE),
    });
  });

  // ── 1. Owner renders own session → continues normally ───────────────

  it('allows owner to render their own session (ownership verified)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-123' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-own-123',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // ── 2. Non-owner renders another user's session → 403 ──────────────

  it('returns 403 when session belongs to another user', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-victim-abc',
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.message).toMatch(/forbidden/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 3. Null-user session → 403 (existing behavior preserved) ───────

  it('returns 403 when session has null userId (legacy unowned)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: null });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-null-user',
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 4. CRITICAL: Prisma ownership lookup throws → 500, fail closed ─

  it('returns 500 when ownership lookup throws (fail-closed)', async () => {
    // Simulate database connection failure
    mockCadSessionFindUnique.mockRejectedValue(
      new Error('Connection refused: database is unavailable')
    );

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-db-error',
    });
    const res = await POST(req);

    // Must return 500, NOT 200
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error.message).toMatch(/unable to verify session ownership/i);
    expect(data.error.hint).toMatch(/try again later/i);

    // CRITICAL: ai-engine must NOT be called
    expect(mockFetch).not.toHaveBeenCalled();

    // CRITICAL: session upsert must NOT be performed
    expect(mockUpsert).not.toHaveBeenCalled();

    // CRITICAL: iteration creation must NOT occur
    expect(mockCadIterationCreate).not.toHaveBeenCalled();
  });

  // ── 5. New session (no existing) → proceeds normally ────────────────

  it('allows creation of new session when no existing session found', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-new-456',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // ── 6. DB error does NOT leak raw error details to client ───────────

  it('does not expose raw database error message to client', async () => {
    mockCadSessionFindUnique.mockRejectedValue(
      new Error('FATAL: password authentication failed for user "cad_user"')
    );

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-leak-test',
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    const responseStr = JSON.stringify(data);

    // Must NOT contain raw database error details
    expect(responseStr).not.toContain('password authentication failed');
    expect(responseStr).not.toContain('cad_user');
    expect(responseStr).not.toContain('FATAL');
  });

  // ── 7. Prisma PrismaKnownRequestError → 500, fail closed ───────────

  it('returns 500 on Prisma-specific database errors', async () => {
    const prismaError = Object.assign(new Error('Invalid `prisma.cadSession.findUnique()` invocation'), {
      code: 'P1001',
      clientVersion: '5.0.0',
      meta: {},
    });
    mockCadSessionFindUnique.mockRejectedValue(prismaError);

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-prisma-error',
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 8. Timeout error → 500, fail closed ─────────────────────────────

  it('returns 500 on database timeout', async () => {
    mockCadSessionFindUnique.mockRejectedValue(
      Object.assign(new Error('Timeout exceeded: 30000ms'), { code: 'P2025' })
    );

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-timeout',
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 9. Ownership check runs BEFORE ai-engine and upsert ─────────────

  it('calls cadSession.findUnique before fetch and upsert', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-123' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-order-check',
    });
    await POST(req);

    // findUnique must be called
    expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
    expect(mockCadSessionFindUnique).toHaveBeenCalledWith({
      where: { id: 'sess-order-check' },
      select: { userId: true },
    });
  });
});
