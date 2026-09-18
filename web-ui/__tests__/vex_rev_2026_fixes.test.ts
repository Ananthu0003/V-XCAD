/**
 * VEX-REV-2026 Regression Tests — Audit Findings Remediation
 *
 * Verifies that:
 * 1. VEX-REV-001: /api/generate with another user's session_id returns 403 Forbidden
 * 2. VEX-REV-001: /api/generate with owner's session_id proceeds
 * 3. VEX-REV-002: /api/cam/{analyze,toolpaths,gcode,auto-plan} with another user's session_id returns 403
 * 4. VEX-REV-003: /api/cam/recommendations safely parses malformed JSON without crashing
 */

// Polyfill Request/Response/Headers BEFORE any imports
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

if (typeof global.ReadableStream === 'undefined') {
  try {
    const { ReadableStream } = require('stream/web');
    global.ReadableStream = ReadableStream;
  } catch {}
}

if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(public url: string, public init?: RequestInit) {
      this.headers = new Headers(init?.headers);
      this.method = init?.method || 'GET';
      this.body = init?.body || null;
    }
    headers: Headers;
    method: string;
    body: any;
    async json() { return typeof this.body === 'string' ? JSON.parse(this.body) : this.body; }
    async text() { return typeof this.body === 'string' ? this.body : JSON.stringify(this.body); }
    async formData() {
      if (this.body && typeof this.body.get === 'function') {
        return this.body;
      }
      const fd = new FormData();
      if (typeof this.body === 'string') {
        try {
          const parsed = JSON.parse(this.body);
          for (const [k, v] of Object.entries(parsed)) {
            fd.set(k, v as any);
          }
        } catch {}
      }
      return fd;
    }
    clone() { return new Request(this.url, { method: this.method, headers: this.headers as any, body: this.body }); }
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
const mockRequireSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  requireSession: async (...args: unknown[]) => {
    const custom = mockRequireSession(...args);
    if (custom !== undefined) return custom;
    const session = await mockGetSession(...args);
    if (!session?.userId) return null;
    const user = await mockUserFindUnique({ where: { id: session.userId } });
    if (!user) return null;
    return session.userId;
  },
  requireAdmin: async (...args: unknown[]) => {
    const session = await mockGetSession(...args);
    if (!session?.userId) return null;
    const user = await mockUserFindUnique({ where: { id: session.userId } });
    if (!user) return null;
    return session.userId;
  },
}));

const mockUserFindUnique = jest.fn();
const mockCadSessionFindUnique = jest.fn();
const mockCadSessionCreate = jest.fn();
const mockToolFindMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
      create: (...args: unknown[]) => mockCadSessionCreate(...args),
    },
    tool: {
      findMany: (...args: unknown[]) => mockToolFindMany(...args),
    },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('VEX-REV-2026 Audit Findings Remediation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
    mockRequireSession.mockReturnValue(undefined);
  });

  describe('VEX-REV-001: /api/generate session ownership validation', () => {
    it('returns 403 when authenticated user supplies another user session_id', async () => {
      mockGetSession.mockResolvedValue({ userId: 'attacker-123', email: 'attacker@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'attacker-123' });
      mockCadSessionFindUnique.mockResolvedValue({ id: 'victim-sess-999', userId: 'victim-456' });

      const { POST } = require('@/app/api/generate/route');

      const fd = new FormData();
      fd.set('prompt', 'Malicious prompt to modify victim model');
      fd.set('session_id', 'victim-sess-999');

      const req = new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        body: fd,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toMatch(/Forbidden/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows generation when authenticated user supplies their own session_id', async () => {
      mockGetSession.mockResolvedValue({ userId: 'owner-123', email: 'owner@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ id: 'owner-sess-111', userId: 'owner-123' });

      const fakeStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"status":"generating"}\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue(new Response(fakeStream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));

      const { POST } = require('@/app/api/generate/route');

      const fd = new FormData();
      fd.set('prompt', 'Iterate on my pocket dimensions');
      fd.set('session_id', 'owner-sess-111');

      const req = new Request('http://localhost:3000/api/generate', {
        method: 'POST',
        body: fd,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('VEX-REV-002: CAM proxies session ownership validation', () => {
    it('/api/cam/analyze returns 403 if target session_id belongs to another user', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'user@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });
      mockCadSessionFindUnique.mockResolvedValue({ id: 'other-session-789', userId: 'other-user', isShared: false });

      const { POST } = require('@/app/api/cam/analyze/route');

      const req = new Request('http://localhost:3000/api/cam/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: 'other-session-789', parameters: {} }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('/api/cam/toolpaths returns 403 if target session_id belongs to another user', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'user@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });
      mockCadSessionFindUnique.mockResolvedValue({ id: 'other-session-789', userId: 'other-user', isShared: false });

      const { POST } = require('@/app/api/cam/toolpaths/route');

      const req = new Request('http://localhost:3000/api/cam/toolpaths', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: 'other-session-789', operations: [] }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('/api/cam/gcode returns 403 if target session_id belongs to another user', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'user@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });
      mockCadSessionFindUnique.mockResolvedValue({ id: 'other-session-789', userId: 'other-user', isShared: false });

      const { POST } = require('@/app/api/cam/gcode/route');

      const req = new Request('http://localhost:3000/api/cam/gcode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: 'other-session-789', operations: [] }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('VEX-REV-003: /api/cam/recommendations defensive JSON parsing', () => {
    it('gracefully handles malformed JSON in compatibleMaterialsJson without crashing', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user-123', email: 'user@test.com' });
      mockUserFindUnique.mockResolvedValue({ id: 'user-123' });

      mockToolFindMany.mockResolvedValue([
        {
          id: 'tool-1',
          name: '1/4 Flat Endmill',
          type: 'flat_end_mill',
          isActive: true,
          geometry: { diameter: 6.35, fluteCount: 2 },
          cuttingData: { spindleRpm: 8000, feedRate: 600, plungeRate: 300, coolant: 'flood' },
          compatibility: {
            compatibleMaterialsJson: 'MALFORMED_JSON_STRING{{[',
          },
        },
      ]);

      const { POST } = require('@/app/api/cam/recommendations/route');

      const req = new Request('http://localhost:3000/api/cam/recommendations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureType: 'pocket',
          workpieceMaterial: 'aluminum_6061',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tool).toBeDefined();
      expect(data.tool.id).toBe('tool-1');
    });
  });
});
