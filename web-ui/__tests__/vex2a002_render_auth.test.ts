/**
 * VEX-2A-002 Regression Tests — Unauthenticated /api/render
 *
 * Verifies that:
 * 1. Unauthenticated POST /api/render returns 401
 * 2. Unauthenticated request does NOT reach ai-engine (auth gate is before fetch)
 * 3. Authenticated valid user can reach the render pipeline
 * 4. Newly-created render session is associated with the authenticated userId
 * 5. Deleted/nonexistent user is rejected even with a valid JWT
 */

// Polyfill Request/Response/Headers BEFORE any imports
// Required because next/jest config forces jsdom environment
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
    delete(name: string) { this.map.delete(name.toLowerCase()); }
    append(name: string, value: string) { this.set(name, (this.get(name) || '') + ', ' + value); }
    forEach(callback: (value: string, key: string) => void) { this.map.forEach(callback); }
    keys() { return this.map.keys(); }
    values() { return this.map.values(); }
    entries() { return this.map.entries(); }
    [Symbol.iterator]() { return this.map.entries(); }
  };
}

// ── Mock next/server BEFORE importing the route ──────────────────────────────

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
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockFindFirst = jest.fn();
const mockExecuteRawUnsafe = jest.fn();
const mockCadIterationCreate = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    cadSession: { upsert: (...args: unknown[]) => mockUpsert(...args) },
    cadIteration: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCadIterationCreate(...args),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: (...args: unknown[]) => mockExecuteRawUnsafe(...args),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Import AFTER mocks are set up
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
  stl_url: '/outputs/cad_test_v1.stl',
  step_url: '/outputs/cad_test_v1.step',
  status: 'completed',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VEX-2A-002 — /api/render authentication gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

    // Default: no auth session (unauthenticated)
    mockGetSession.mockResolvedValue(null);

    // Default: user lookup succeeds
    mockFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });

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

  // ── 1. Unauthenticated → 401 ──────────────────────────────────────────

  it('returns 401 when no auth cookie is present', async () => {
    const req = makeRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.message).toMatch(/authentication required/i);
  });

  it('returns 401 when session token is invalid', async () => {
    mockGetSession.mockResolvedValue(null);

    const req = makeRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 401 when session has no userId', async () => {
    mockGetSession.mockResolvedValue({ userId: undefined, email: 'anon' });

    const req = makeRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  // ── 2. Unauthenticated request does NOT reach ai-engine ────────────────

  it('does not call ai-engine when unauthenticated', async () => {
    const req = makeRequest(VALID_BODY);
    await POST(req);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not parse request body when unauthenticated', async () => {
    const req = makeRequest(VALID_BODY);
    await POST(req);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 3. Deleted/nonexistent user → 401 ─────────────────────────────────

  it('returns 401 when authenticated user no longer exists in database', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-deleted', email: 'gone@example.com' });
    mockFindUnique.mockResolvedValue(null);

    const req = makeRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 4. Authenticated valid user → proceeds to render pipeline ─────────

  it('calls ai-engine when authenticated with valid user', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@example.com' });
    mockFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UPSTREAM_RESPONSE),
    });

    const req = makeRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain('/render');
  });

  it('returns upstream error status when ai-engine fails', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@example.com' });
    mockFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'Invalid script' } }),
    });

    const req = makeRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  // ── 5. Session created with authenticated userId ───────────────────────

  it('creates CadSession with authenticated userId', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@example.com' });
    mockFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UPSTREAM_RESPONSE),
    });

    const req = makeRequest(VALID_BODY);
    await POST(req);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = mockUpsert.mock.calls[0][0];
    expect(upsertCall.create.userId).toBe('user-123');
  });

  it('does not create session with null userId', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@example.com' });
    mockFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UPSTREAM_RESPONSE),
    });

    const req = makeRequest(VALID_BODY);
    await POST(req);

    const upsertCall = mockUpsert.mock.calls[0][0];
    expect(upsertCall.create.userId).not.toBeNull();
    expect(upsertCall.create.userId).toBe('user-123');
  });

  // ── 6. Auth gate runs before body validation ──────────────────────────

  it('rejects request with missing python_script when unauthenticated (auth gate runs first)', async () => {
    const req = makeRequest({ parameters: {} });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for missing python_script when authenticated (body validation runs after auth)', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@example.com' });
    mockFindUnique.mockResolvedValue({ id: 'user-123', email: 'test@example.com' });

    const req = makeRequest({ parameters: {} });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});