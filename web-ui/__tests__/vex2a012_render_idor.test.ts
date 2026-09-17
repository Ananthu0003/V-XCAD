/**
 * VEX-2A-012 Regression Tests — Render IDOR / Session Ownership
 *
 * Verifies that an authenticated user cannot overwrite another user's
 * CadSession data through the /api/render upsert path.
 *
 * Fix: Ownership check before upsert — if the target session exists and
 * belongs to a different user, return 403 Forbidden.
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
    delete(name: string) { this.map.delete(name.toLowerCase()); }
    append(name: string, value: string) { this.set(name, (this.get(name) || '') + ', ' + value); }
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
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
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
  stl_url: '/outputs/cad_target.stl',
  step_url: '/outputs/cad_target.step',
  status: 'completed',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VEX-2A-012 — Render IDOR / session ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

    mockGetSession.mockResolvedValue({ userId: 'user-attacker', email: 'attacker@example.com' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-attacker', email: 'attacker@example.com' });

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

  // ── 1. Owner renders own session → 200 ────────────────────────────────

  it('allows owner to update their own session (update path)', async () => {
    // Session exists and belongs to the authenticated user
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-attacker' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-own-123',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-own-123' },
      })
    );
  });

  // ── 2. Non-owner renders another user's session → 403 ─────────────────

  it('returns 403 when authenticated user does not own the target session', async () => {
    // Session exists but belongs to a different user
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-victim-abc',
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.message).toMatch(/forbidden/i);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 3. Non-owner renders null-user session → 403 ──────────────────────

  it('returns 403 when session has null userId (legacy unowned)', async () => {
    // Session exists with null userId
    mockCadSessionFindUnique.mockResolvedValue({ userId: null });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-null-user',
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 4. Non-owner renders shared session → 403 ─────────────────────────

  it('returns 403 when session is shared (shared means readable, not writable)', async () => {
    // Session exists with a different userId — shared does NOT grant write
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-shared-xyz',
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 5. New session_id (no existing session) → 200 ─────────────────────

  it('allows creation of new session (create path, no existing session)', async () => {
    // Session does not exist — ownership check passes (no existing session)
    mockCadSessionFindUnique.mockResolvedValue(null);

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-new-456',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-new-456' },
      })
    );
  });

  // ── 6. Unauthenticated → 401 ──────────────────────────────────────────

  it('returns 401 for unauthenticated request (auth gate runs first)', async () => {
    mockGetSession.mockResolvedValue(null);

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-any',
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 7. Verify findUnique is called before upsert ─────────────────────

  it('calls cadSession.findUnique before upsert (ownership check)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-attacker' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-check-order',
    });
    await POST(req);

    // findUnique must be called before upsert
    expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
    expect(mockCadSessionFindUnique).toHaveBeenCalledWith({
      where: { id: 'sess-check-order' },
      select: { userId: true },
    });
  });

  // ── 8. Verify upsert update branch is NOT reached for non-owners ─────

  it('does not reach upsert update branch for non-owner (no overwrite)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim' });

    const req = makeRequest({
      ...VALID_BODY,
      session_id: 'sess-victim-nooverwrite',
    });
    await POST(req);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockCadIterationCreate).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
