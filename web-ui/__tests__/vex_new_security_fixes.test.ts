/**
 * VEX-NEW Regression Tests — Security Fixes Audit (HEAD f652b26)
 *
 * Tests for:
 *  - VEX-NEW-01: Orphaned file access denied
 *  - VEX-NEW-02: Non-session file access denied
 *  - VEX-NEW-05: Security headers present in config
 *  - VEX-NEW-07: auth/me and auth/profile use requireSession()
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
  } as any;
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
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
    }
  } as any;
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
    forEach(callback: (value: string, key: string) => void) { this.map.forEach(callback); }
  } as any;
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
const mockRequireSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  requireSession: (...args: unknown[]) => mockRequireSession(...args),
}));

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    cadSession: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}));

const mockReadFile = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

function makePatchRequest(url: string, body?: any): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const AUTH_USER = { userId: 'user-1', email: 'user@test.com', tokenVersion: 0 };
const OWN_SESSION = { userId: 'user-1', isShared: false };
const OTHER_SESSION = { userId: 'user-other', isShared: false };
const NULL_USER_SESSION = { userId: null, isShared: false };

// ── VEX-NEW-01: Orphaned file access denied ───────────────────────────────

describe('VEX-NEW-01 — Orphaned file access denied', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
  });

  it('denies access to orphaned cad_ file (session deleted from DB)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }) // auth gate user check
      .mockResolvedValueOnce(null); // session not in DB (orphaned)

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_orphaned-session.stl');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_orphaned-session.stl'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('denies access to orphaned versioned cad_ file', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }) // auth gate
      .mockResolvedValueOnce(null); // session not in DB (orphaned)

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_orphaned_v2.step');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_orphaned_v2.step'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('denies access to orphaned py.txt file', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }) // auth gate
      .mockResolvedValueOnce(null); // session not in DB (orphaned)

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/cad_orphaned.py.txt');
    const res = await GET(req, { params: Promise.resolve({ path: ['cad_orphaned.py.txt'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});

// ── VEX-NEW-02: Non-session file access denied ────────────────────────────

describe('VEX-NEW-02 — Non-session file access denied', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
  });

  it('denies access to non-cad_ files (arbitrary filename)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }); // auth gate

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/some-random-file.txt');
    const res = await GET(req, { params: Promise.resolve({ path: ['some-random-file.txt'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('denies access to .py files (no cad_ prefix)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }); // auth gate

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/latest_generated_script.py');
    const res = await GET(req, { params: Promise.resolve({ path: ['latest_generated_script.py'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('denies access to .json files (no cad_ prefix)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }); // auth gate

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/config.json');
    const res = await GET(req, { params: Promise.resolve({ path: ['config.json'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('denies access to .log files (no cad_ prefix)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'user-1' }); // auth gate

    const { GET } = require('@/app/api/outputs/[...path]/route');
    const req = makeGetRequest('http://localhost:3000/api/outputs/debug.log');
    const res = await GET(req, { params: Promise.resolve({ path: ['debug.log'] }) });

    expect(res.status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});

// ── VEX-NEW-05: Security headers in config ────────────────────────────────

describe('VEX-NEW-05 — Security headers in Next.js config', () => {
  it('next.config.ts contains all required security headers', () => {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.resolve(__dirname, '../next.config.ts');
    const content = fs.readFileSync(configPath, 'utf-8');

    expect(content).toContain('X-Content-Type-Options');
    expect(content).toContain('nosniff');
    expect(content).toContain('X-Frame-Options');
    expect(content).toContain('DENY');
    expect(content).toContain('Referrer-Policy');
    expect(content).toContain('strict-origin-when-cross-origin');
    expect(content).toContain('X-XSS-Protection');
    expect(content).toContain('1; mode=block');
    expect(content).toContain('Strict-Transport-Security');
    expect(content).toContain('max-age=');
    expect(content).toContain('includeSubDomains');
    expect(content).toContain('preload');
  });
});

// ── VEX-NEW-07: auth/me and auth/profile use requireSession() ─────────────

describe('VEX-NEW-07 — auth/me and auth/profile use requireSession()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireSession.mockResolvedValue(AUTH_USER.userId);
    mockFindUnique.mockResolvedValue({ id: AUTH_USER.userId, name: 'Test User', email: 'user@test.com' });
  });

  describe('GET /api/auth/me', () => {
    it('uses requireSession (not getSession) for tokenVersion validation', async () => {
      const { GET } = require('@/app/api/auth/me/route');
      const req = makeGetRequest('http://localhost:3000/api/auth/me');
      const res = await GET(req);

      expect(mockRequireSession).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });

    it('returns 401 when requireSession returns null (invalid tokenVersion)', async () => {
      mockRequireSession.mockResolvedValueOnce(null);

      const { GET } = require('@/app/api/auth/me/route');
      const req = makeGetRequest('http://localhost:3000/api/auth/me');
      const res = await GET(req);

      expect(res.status).toBe(401);
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('does not use getSession', async () => {
      const { GET } = require('@/app/api/auth/me/route');
      const req = makeGetRequest('http://localhost:3000/api/auth/me');
      await GET(req);

      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/auth/profile', () => {
    it('uses requireSession (not getSession) for tokenVersion validation', async () => {
      mockUpdate.mockResolvedValueOnce({ id: AUTH_USER.userId, name: 'New Name', email: 'user@test.com' });
      const { PATCH } = require('@/app/api/auth/profile/route');
      const req = makePatchRequest('http://localhost:3000/api/auth/profile', { name: 'New Name' });
      const res = await PATCH(req);

      expect(mockRequireSession).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });

    it('returns 401 when requireSession returns null (invalid tokenVersion)', async () => {
      mockRequireSession.mockResolvedValueOnce(null);

      const { PATCH } = require('@/app/api/auth/profile/route');
      const req = makePatchRequest('http://localhost:3000/api/auth/profile', { name: 'New Name' });
      const res = await PATCH(req);

      expect(res.status).toBe(401);
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('does not use getSession', async () => {
      const { PATCH } = require('@/app/api/auth/profile/route');
      const req = makePatchRequest('http://localhost:3000/api/auth/profile', { name: 'New Name' });
      await PATCH(req);

      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });
});
