/**
 * VEX-2A-013b Regression Tests — simulate/prepare Cross-Session Write IDOR
 *
 * Verifies that an authenticated user cannot create CamSetup, CamTool,
 * CamOperation, or SimulationRun records under another user's CadSession
 * through POST /api/cam/[jobId]/simulate/prepare.
 *
 * Fix: Ownership check before ai-engine invocation — look up CadSession
 * by jobId and verify userId matches the authenticated user.
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
const mockTransaction = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Import AFTER mocks are set up
const routeModule = require('@/app/api/cam/[jobId]/simulate/prepare/route');
const { POST } = routeModule;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/cam/sess-victim-123/simulate/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRequestForJob(jobId: string, body: unknown): Request {
  return new Request(`http://localhost:3000/api/cam/${jobId}/simulate/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  setup: { stock_length: 100, stock_width: 50, stock_height: 30, wcs: 'G54' },
  tools: [{ id: 'tool-1', tool_type: 'flat_end_mill', diameter_mm: 10, length_mm: 50, flute_count: 2 }],
  operations: [{ id: 'op-1', tool_id: 'tool-1', operation_type: 'contour', operation_order: 1 }],
};

const UPSTREAM_RESPONSE = {
  simulationRunId: 'sim-run-123',
  simulationRun: {
    total_runtime_sec: 60,
    total_distance_mm: 500,
    cutting_distance_mm: 300,
    rapid_distance_mm: 200,
    status: 'completed',
    validation_status: 'passed',
    validation_errors: [],
    validation_warnings: [],
  },
  setup: { id: 'setup-from-ai', stock_length: 100, stock_width: 50, stock_height: 30, wcs: 'G54' },
  tools: [{ id: 'tool-1', tool_type: 'flat_end_mill', diameter_mm: 10, length_mm: 50, flute_count: 2 }],
  operations: [{ id: 'op-1', tool_id: 'tool-1', operation_type: 'contour', operation_order: 1 }],
  segments: [],
  timeline: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VEX-2A-013b — simulate/prepare cross-session write IDOR', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

    // Default: authenticated as user-owner
    mockGetSession.mockResolvedValue({ userId: 'user-owner', email: 'owner@example.com' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-owner', email: 'owner@example.com' });

    // Default: transaction succeeds (calls the callback with a mock tx)
    mockTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        camSetup: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
        camTool: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
        camOperation: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
        simulationRun: {
          create: jest.fn().mockResolvedValue({}),
        },
        toolpathSegment: {
          createMany: jest.fn().mockResolvedValue({}),
        },
        simulationEvent: {
          createMany: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    // Default: ai-engine returns success
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UPSTREAM_RESPONSE),
    });
  });

  // ── 1. Authenticated owner targeting own session → 200 ────────────────

  it('allows owner to simulate their own session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner' });

    const req = makeRequestForJob('sess-owner-123', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-owner-123' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.simulationRunId).toBe('sim-run-123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  // ── 2. Authenticated non-owner targeting private session → 403 ────────

  it('returns 403 when targeting another user\'s private session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim' });

    const req = makeRequestForJob('sess-victim-456', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-victim-456' }) });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.message).toMatch(/forbidden/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── 3. Authenticated non-owner targeting shared session → 403 ─────────

  it('returns 403 when targeting another user\'s shared session', async () => {
    // Shared does NOT grant write permission
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-other' });

    const req = makeRequestForJob('sess-shared-789', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-shared-789' }) });

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── 4. Authenticated user targeting null-user session → 403 ───────────

  it('returns 403 when targeting a null-user/legacy session', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: null });

    const req = makeRequestForJob('sess-null-user', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-null-user' }) });

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── 5. Authenticated user targeting nonexistent jobId → 404 ───────────

  it('returns 404 when targeting a nonexistent session', async () => {
    mockCadSessionFindUnique.mockResolvedValue(null);

    const req = makeRequestForJob('sess-nonexistent', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-nonexistent' }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.message).toMatch(/not found/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── 6. Unauthenticated request → 401 ──────────────────────────────────

  it('returns 401 for unauthenticated request (auth gate runs first)', async () => {
    mockGetSession.mockResolvedValue(null);

    const req = makeRequestForJob('sess-any', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-any' }) });

    expect(res.status).toBe(401);
    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── 7. Ownership check occurs before ai-engine fetch ──────────────────

  it('calls cadSession.findUnique before fetch (ownership check ordering)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim' });

    const req = makeRequestForJob('sess-check-order', VALID_BODY);
    await POST(req, { params: Promise.resolve({ jobId: 'sess-check-order' }) });

    // findUnique must be called before any fetch or transaction
    expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
    expect(mockCadSessionFindUnique).toHaveBeenCalledWith({
      where: { id: 'sess-check-order' },
      select: { userId: true },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── 8. Non-owner produces no database/AI side effects ─────────────────

  it('produces no side effects for non-owner (no ai-engine, no transaction, no records)', async () => {
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim' });

    const req = makeRequestForJob('sess-victim-noeffects', VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ jobId: 'sess-victim-noeffects' }) });

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    // Verify no Prisma writes were attempted outside of transaction
    expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
  });
});
