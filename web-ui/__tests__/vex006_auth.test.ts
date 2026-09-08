/**
 * VEX-006 Regression Tests — AI-Engine Authentication Boundary
 *
 * Verifies that:
 * 1. Unauthenticated access to every new/modified BFF route returns 401
 * 2. Authenticated requests are forwarded to ai-engine
 * 3. Request/response contracts are preserved
 * 4. No NEXT_PUBLIC_FASTAPI_URL remains in client code
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
    delete(name: string) { this.map.delete(name.toLowerCase()); }
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

// ── Shared Mocks ──────────────────────────────────────────────────────────

const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockUserFindUnique = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ── Helper ────────────────────────────────────────────────────────────────

function makeRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${url}`, init);
}

// ── Route Definitions ─────────────────────────────────────────────────────

const BFF_ROUTES = [
  { name: '/api/blueprint/[id]',           method: 'GET',    url: '/api/blueprint/test-session-123',           route: '@/app/api/blueprint/[id]/route' },
  { name: '/api/assistant/compare',        method: 'POST',   url: '/api/assistant/compare',                    route: '@/app/api/assistant/compare/route' },
  { name: '/api/cam/simulate/prepare',     method: 'POST',   url: '/api/cam/job123/simulate/prepare',          route: '@/app/api/cam/[jobId]/simulate/prepare/route' },
  { name: '/api/cam/analyze',              method: 'POST',   url: '/api/cam/analyze',                          route: '@/app/api/cam/analyze/route' },
  { name: '/api/cam/auto-plan',            method: 'POST',   url: '/api/cam/auto-plan',                        route: '@/app/api/cam/auto-plan/route' },
  { name: '/api/cam/toolpaths',            method: 'POST',   url: '/api/cam/toolpaths',                        route: '@/app/api/cam/toolpaths/route' },
  { name: '/api/cam/gcode',                method: 'POST',   url: '/api/cam/gcode',                            route: '@/app/api/cam/gcode/route' },
  { name: '/api/cam/recommend-machine',    method: 'POST',   url: '/api/cam/recommend-machine',                route: '@/app/api/cam/recommend-machine/route' },
  { name: '/api/knowledge/documents',      method: 'GET',    url: '/api/knowledge/documents',                  route: '@/app/api/knowledge/documents/route' },
  { name: '/api/knowledge/documents/ingest', method: 'POST', url: '/api/knowledge/documents/ingest',           route: '@/app/api/knowledge/documents/ingest/route' },
  { name: '/api/knowledge/retrieve',       method: 'POST',   url: '/api/knowledge/retrieve',                   route: '@/app/api/knowledge/retrieve/route' },
  { name: '/api/knowledge/documents/:id',  method: 'DELETE', url: '/api/knowledge/documents/doc-123',          route: '@/app/api/knowledge/documents/[docId]/route' },
];

const JSON_BODY_ROUTES = new Set([
  '/api/assistant/compare',
  '/api/cam/simulate/prepare',
  '/api/cam/analyze',
  '/api/cam/auto-plan',
  '/api/cam/toolpaths',
  '/api/cam/gcode',
  '/api/cam/recommend-machine',
  '/api/knowledge/retrieve',
  '/api/knowledge/documents/ingest',
]);

const SIMULATE_BODY = {
  setup: { stock_length: 100, stock_width: 50, stock_height: 30, wcs: 'G54' },
  tools: [],
  operations: [],
};

function getBodyForRoute(url: string): unknown {
  if (url.includes('simulate/prepare')) return SIMULATE_BODY;
  if (url.includes('retrieve')) return { query: 'test' };
  if (url.includes('ingest')) return null; // FormData handled separately
  return { session_id: 'test', parameters: {} };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('VEX-006 — BFF authentication boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
    mockGetSession.mockResolvedValue(null); // unauthenticated by default
    mockUserFindUnique.mockResolvedValue(null);
  });

  describe('Unauthenticated access returns 401', () => {
    for (const route of BFF_ROUTES) {
      it(`${route.method} ${route.name} → 401`, async () => {
        const routeModule = require(route.route);
        const handler = route.method === 'GET' ? routeModule.GET : route.method === 'DELETE' ? routeModule.DELETE : routeModule.POST;

        const body = (route.method !== 'GET' && route.method !== 'DELETE')
          ? getBodyForRoute(route.url)
          : undefined;

        const req = makeRequest(route.method, route.url, body);

        // Determine params based on route pattern
        let routeParams: any = undefined;
        if (route.url.includes('blueprint')) {
          routeParams = { params: Promise.resolve({ id: 'test-session-123' }) };
        } else if (route.url.includes('doc-123') || route.url.includes('[docId]')) {
          routeParams = { params: Promise.resolve({ docId: 'doc-123' }) };
        } else if (route.url.includes('simulate/prepare') || route.url.includes('job123')) {
          routeParams = { params: Promise.resolve({ jobId: 'job123' }) };
        }

        const res = await handler(req, routeParams);

        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.error.message).toMatch(/authentication required/i);

        // Must NOT have called ai-engine
        expect(mockFetch).not.toHaveBeenCalled();
      });
    }
  });

  describe('Deleted/nonexistent user returns 401', () => {
    for (const route of BFF_ROUTES.filter(r => r.method === 'POST')) {
      it(`${route.method} ${route.name} with deleted user → 401`, async () => {
        mockGetSession.mockResolvedValue({ userId: 'user-deleted', email: 'gone@test.com' });
        mockUserFindUnique.mockResolvedValue(null); // user not in DB

        const routeModule = require(route.route);
        const handler = routeModule.POST;

        const body = getBodyForRoute(route.url);
        const req = makeRequest(route.method, route.url, body);

        let routeParams: any = undefined;
        if (route.url.includes('simulate/prepare') || route.url.includes('job123')) {
          routeParams = { params: Promise.resolve({ jobId: 'job123' }) };
        }

        const res = await handler(req, routeParams);

        expect(res.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
      });
    }
  });

  describe('Authenticated request reaches ai-engine', () => {
    for (const route of BFF_ROUTES.filter(r => r.method === 'POST' && !r.url.includes('ingest'))) {
      it(`${route.method} ${route.name} with valid session → forwards to ai-engine`, async () => {
        mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@test.com' });
        mockUserFindUnique.mockResolvedValue({ id: 'user-123' });

        const upstreamResponse = new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
        mockFetch.mockResolvedValue(upstreamResponse);

        const routeModule = require(route.route);
        const handler = routeModule.POST;

        const body = getBodyForRoute(route.url);
        const req = makeRequest(route.method, route.url, body);

        let routeParams: any = undefined;
        if (route.url.includes('simulate/prepare') || route.url.includes('job123')) {
          routeParams = { params: Promise.resolve({ jobId: 'job123' }) };
        }

        const res = await handler(req, routeParams);

        // Should have forwarded to ai-engine
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];
        expect(fetchUrl).toContain('/api/v1/');
        expect(fetchOpts.method).toBe('POST');
      });
    }
  });

  describe('Contract preservation', () => {
    it('/api/cam/analyze preserves JSON body and response', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });

      const upstreamPayload = {
        features: [{ type: 'pocket', dimensions: { width: 20 } }],
        machine_recommendation: { primaryRecommendation: { profileId: 'haas_umc750' } },
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

      const routeModule = require('@/app/api/cam/analyze/route');
      const req = makeRequest('POST', '/api/cam/analyze', { session_id: 'sess-1', parameters: {} });
      const res = await routeModule.POST(req);
      const data = await res.json();

      expect(data.features).toHaveLength(1);
      expect(data.machine_recommendation.primaryRecommendation.profileId).toBe('haas_umc750');
    });

    it('/api/cam/gcode preserves response fields (can_generate_gcode, gcode, toolpaths)', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });

      const upstreamPayload = {
        can_generate_gcode: true,
        gcode: 'G0 X0 Y0 Z5\nG1 X10 F1000',
        klartext: 'G0 X0 Y0 Z5',
        toolpaths: [{ move_type: 'linear', start_x: 0 }],
        planned_cycle_time_seconds: 42.5,
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

      const routeModule = require('@/app/api/cam/gcode/route');
      const req = makeRequest('POST', '/api/cam/gcode', { session_id: 's', job_id: 'j', cam_run_id: '', setup_id: null });
      const res = await routeModule.POST(req);
      const data = await res.json();

      expect(data.can_generate_gcode).toBe(true);
      expect(data.gcode).toContain('G0 X0');
      expect(data.toolpaths).toHaveLength(1);
      expect(data.planned_cycle_time_seconds).toBe(42.5);
    });

    it('/api/knowledge/documents preserves list response', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });

      const upstreamPayload = { documents: [{ id: 'doc-1', filename: 'iso.pdf', status: 'Active' }] };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(upstreamPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

      const routeModule = require('@/app/api/knowledge/documents/route');
      const req = makeRequest('GET', '/api/knowledge/documents');
      const res = await routeModule.GET(req);
      const data = await res.json();

      expect(data.documents).toHaveLength(1);
      expect(data.documents[0].filename).toBe('iso.pdf');
    });

    it('/api/blueprint/[id] preserves binary response', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'test@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });

      const fakePng = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const upstreamResponse = new Response(fakePng, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
      mockFetch.mockResolvedValue(upstreamResponse);

      const routeModule = require('@/app/api/blueprint/[id]/route');
      const req = makeRequest('GET', '/api/blueprint/sess-123');
      const res = await routeModule.GET(req, { params: Promise.resolve({ id: 'sess-123' }) });

      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toContain('max-age=3600');
    });
  });
});

describe('VEX-006 — No NEXT_PUBLIC_FASTAPI_URL in client code', () => {
  it('no NEXT_PUBLIC_FASTAPI_URL references remain in web-ui source', () => {
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.resolve(__dirname, '../components');
    const appDir = path.resolve(__dirname, '../app');

    function checkDir(dir: string): string[] {
      const violations: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          violations.push(...checkDir(fullPath));
        } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes('NEXT_PUBLIC_FASTAPI_URL') || content.includes('NEXT_PUBLIC_API_URL')) {
            violations.push(fullPath);
          }
        }
      }
      return violations;
    }

    const violations = [...checkDir(srcDir), ...checkDir(appDir)];
    expect(violations).toEqual([]);
  });
});
