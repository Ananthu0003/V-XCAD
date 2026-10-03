/**
 * P0-02 Regression Tests — Knowledge BFF Authorization + Service Authentication
 *
 * Verifies that:
 * 1. Unauthenticated requests are denied (requireAdmin returns null)
 * 2. Authenticated non-admin requests are denied (requireAdmin returns null)
 * 3. Authenticated admin requests reach ai-engine
 * 4. BFF sends X-Service-Key to ai-engine
 * 5. Service key is not exposed to client code
 * 6. Unauthenticated non-admin cannot reach DELETE
 * 7. Admin with valid service credential can reach DELETE
 */

// ── Polyfills ──────────────────────────────────────────────────────────────

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
    async formData() { return this.body as any; }
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
    async blob() { return new Blob([this.body as string]); }
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

const mockRequireAdmin = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', isAdmin: true }) },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Set SERVICE_API_KEY
process.env.SERVICE_API_KEY = 'test-service-key-abc123';

// ── Import AFTER mocks ─────────────────────────────────────────────────────

const listRoute = require('@/app/api/knowledge/documents/route');
const ingestRoute = require('@/app/api/knowledge/documents/ingest/route');
const retrieveRoute = require('@/app/api/knowledge/retrieve/route');
const deleteRoute = require('@/app/api/knowledge/documents/[docId]/route');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(): Request {
  return new Request('http://localhost:3000/api/knowledge/documents', {
    method: 'GET',
  });
}

function makePostRequest(body?: unknown): Request {
  return new Request('http://localhost:3000/api/knowledge/retrieve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? { query: 'test' }),
  });
}

function makeDeleteRequest(docId: string = 'doc-1'): Request {
  return new Request(`http://localhost:3000/api/knowledge/documents/${docId}`, {
    method: 'DELETE',
  });
}

function makeIngestRequest(): Request {
  const formData = new FormData();
  formData.append('file', new Blob(['test']), 'test.pdf');
  return new Request('http://localhost:3000/api/knowledge/documents/ingest', {
    method: 'POST',
    body: formData,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('P0-02 — Knowledge BFF Authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERVICE_API_KEY = 'test-service-key-abc123';
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

    // Default: upstream returns success
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ documents: [] }),
    });
  });

  // ── 1. Unauthenticated request denied ──────────────────────────────────

  it('denies unauthenticated GET /api/knowledge/documents', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await listRoute.GET();
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies unauthenticated POST /api/knowledge/retrieve', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await retrieveRoute.POST(makePostRequest());
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies unauthenticated POST /api/knowledge/documents/ingest', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await ingestRoute.POST(makeIngestRequest());
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies unauthenticated DELETE /api/knowledge/documents/:id', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await deleteRoute.DELETE(makeDeleteRequest(), { params: Promise.resolve({ docId: 'doc-1' }) });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 2. Authenticated non-admin denied ─────────────────────────────────

  it('denies non-admin GET /api/knowledge/documents', async () => {
    mockRequireAdmin.mockResolvedValue(null); // requireAdmin returns null for non-admin
    const res = await listRoute.GET();
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies non-admin DELETE /api/knowledge/documents/:id', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await deleteRoute.DELETE(makeDeleteRequest(), { params: Promise.resolve({ docId: 'doc-1' }) });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 3. Authenticated admin reaches ai-engine ──────────────────────────

  it('allows admin GET /api/knowledge/documents to reach ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await listRoute.GET();
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('allows admin POST /api/knowledge/retrieve to reach ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await retrieveRoute.POST(makePostRequest());
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('allows admin POST /api/knowledge/documents/ingest to reach ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await ingestRoute.POST(makeIngestRequest());
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('allows admin DELETE to reach ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await deleteRoute.DELETE(makeDeleteRequest(), { params: Promise.resolve({ docId: 'doc-1' }) });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── 4. BFF sends X-Service-Key ────────────────────────────────────────

  it('GET sends X-Service-Key header to ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    await listRoute.GET();
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers['X-Service-Key']).toBe('test-service-key-abc123');
  });

  it('POST /retrieve sends X-Service-Key header to ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    await retrieveRoute.POST(makePostRequest());
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers['X-Service-Key']).toBe('test-service-key-abc123');
  });

  it('POST /ingest sends X-Service-Key header to ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    await ingestRoute.POST(makeIngestRequest());
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers['X-Service-Key']).toBe('test-service-key-abc123');
  });

  it('DELETE sends X-Service-Key header to ai-engine', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    await deleteRoute.DELETE(makeDeleteRequest(), { params: Promise.resolve({ docId: 'doc-1' }) });
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers['X-Service-Key']).toBe('test-service-key-abc123');
  });

  // ── 5. Service key not exposed to client ──────────────────────────────

  it('does not return service key in response body', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    const res = await listRoute.GET();
    const body = await res.text();
    expect(body).not.toContain('test-service-key-abc123');
    expect(body).not.toContain('SERVICE_API_KEY');
  });

  // ── 6. requireAdmin is used, not getSession ───────────────────────────

  it('calls requireAdmin (not getSession) for GET authorization', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    await listRoute.GET();
    expect(mockRequireAdmin).toHaveBeenCalledTimes(1);
  });

  it('calls requireAdmin (not getSession) for DELETE authorization', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    await deleteRoute.DELETE(makeDeleteRequest(), { params: Promise.resolve({ docId: 'doc-1' }) });
    expect(mockRequireAdmin).toHaveBeenCalledTimes(1);
  });

  // ── 7. Upstream error handling ─────────────────────────────────────────

  it('returns 502 when ai-engine is unreachable', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const res = await listRoute.GET();
    expect(res.status).toBe(502);
  });

  it('returns upstream error status on failure', async () => {
    mockRequireAdmin.mockResolvedValue('admin-1');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Internal error' } }),
    });
    const res = await listRoute.GET();
    expect(res.status).toBe(500);
  });
});
