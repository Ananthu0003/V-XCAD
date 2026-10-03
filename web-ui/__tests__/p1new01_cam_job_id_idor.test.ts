/**
 * P1-NEW-01 Regression Tests — CAM job_id / session_id cross-tenant IDOR
 *
 * The ai-engine partitions CAM artifacts on disk by `job_id`
 * (storage/jobs/{job_id}/cam), but the BFF only authorized `session_id`.
 * A caller could pass an owned session_id together with a victim's job_id.
 *
 * Security property enforced by these tests:
 *   The `job_id` received by the ai-engine is ALWAYS the authorized
 *   `session_id`. A client-supplied `job_id` never reaches the ai-engine.
 *
 * The assertions inspect the exact body handed to fetch() (the ai-engine call),
 * not just the HTTP status of the BFF response.
 */

// Make this file a module so its top-level mocks don't collide with other test files' globals.
export {};

// Polyfill Request/Response/Headers BEFORE any imports
if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(public url: string, public init?: RequestInit) {
      this.headers = new Headers(init?.headers);
      this.method = init?.method || 'GET';
      this.body = (init?.body as string | null | undefined) || null;
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
  } as any;
}

if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    private map = new Map<string, string>();
    constructor(init?: HeadersInit) {
      if (init && typeof init === 'object' && !Array.isArray(init)) {
        Object.entries(init).forEach(([k, v]) => this.map.set(k.toLowerCase(), v as string));
      }
    }
    get(name: string) { return this.map.get(name.toLowerCase()) || null; }
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
  } as any;
}

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
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

const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockUserFindUnique = jest.fn();
const mockCadSessionFindUnique = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    cadSession: { findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args) },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ── Fixtures ──────────────────────────────────────────────────────────────

const ATTACKER_ID = 'user-attacker';
const ATTACKER_SESSION = 'attacker-session-1';
const VICTIM_SESSION = 'victim-session-9';

// Every BFF route that forwards a job_id to an ai-engine handler keyed on it.
const CAM_ROUTES = [
  { name: 'analyze', route: '@/app/api/cam/analyze/route', upstream: '/cam/analyze' },
  { name: 'auto-plan', route: '@/app/api/cam/auto-plan/route', upstream: '/cam/auto_plan' },
  { name: 'toolpaths', route: '@/app/api/cam/toolpaths/route', upstream: '/cam/toolpaths' },
  { name: 'gcode', route: '@/app/api/cam/gcode/route', upstream: '/cam/gcode' },
];

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/cam/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Parsed JSON body of the single call made to the ai-engine. */
function forwardedBody(): Record<string, unknown> {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [, opts] = mockFetch.mock.calls[0];
  return JSON.parse(opts.body as string);
}

/** Raw serialized body of the single call made to the ai-engine. */
function forwardedRaw(): string {
  return mockFetch.mock.calls[0][1].body as string;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe.each(CAM_ROUTES)('P1-NEW-01 — /api/cam/$name job_id derivation', ({ route, upstream }) => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

    mockGetSession.mockResolvedValue({ userId: ATTACKER_ID, email: 'a@test.com' });
    mockUserFindUnique.mockResolvedValue({ id: ATTACKER_ID });
    // Ownership is answered per-session, exactly like the real database:
    // the attacker owns only ATTACKER_SESSION; VICTIM_SESSION belongs to someone else.
    mockCadSessionFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === ATTACKER_SESSION) return { userId: ATTACKER_ID };
      if (where.id === VICTIM_SESSION) return { userId: 'user-victim' };
      return null;
    });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    POST = require(route).POST;
  });

  it('forwards job_id === authorized session_id for a normal request', async () => {
    const res = await POST(makeRequest({ session_id: ATTACKER_SESSION, job_id: ATTACKER_SESSION, parameters: {} }));

    expect(res.status).toBe(200);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`http://ai-engine:8000/api/v1${upstream}`);
    const sent = forwardedBody();
    expect(sent.session_id).toBe(ATTACKER_SESSION);
    expect(sent.job_id).toBe(ATTACKER_SESSION);
  });

  it('REGRESSION: attacker session_id + victim job_id → victim job_id is NOT forwarded', async () => {
    const res = await POST(makeRequest({ session_id: ATTACKER_SESSION, job_id: VICTIM_SESSION, parameters: {} }));

    expect(res.status).toBe(200);
    const sent = forwardedBody();
    // The ai-engine receives the server-authoritative value only.
    expect(sent.job_id).toBe(ATTACKER_SESSION);
    expect(sent.session_id).toBe(ATTACKER_SESSION);
    // The foreign identifier must not appear anywhere in the upstream payload.
    expect(forwardedRaw()).not.toContain(VICTIM_SESSION);
    // Only the authorized session was ever looked up for ownership.
    expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
    expect(mockCadSessionFindUnique.mock.calls[0][0].where.id).toBe(ATTACKER_SESSION);
  });

  it('derives job_id from session_id when the client omits job_id', async () => {
    await POST(makeRequest({ session_id: ATTACKER_SESSION, parameters: {} }));

    expect(forwardedBody().job_id).toBe(ATTACKER_SESSION);
  });

  it.each([
    ['empty string', ''],
    ['number', 12345],
    ['object', { $ne: null }],
    ['array', [VICTIM_SESSION]],
    ['null', null],
    ['path traversal', '../' + VICTIM_SESSION],
  ])('replaces a %s client job_id with the authorized session_id', async (_label, hostileJobId) => {
    await POST(makeRequest({ session_id: ATTACKER_SESSION, job_id: hostileJobId, parameters: {} }));

    const sent = forwardedBody();
    expect(sent.job_id).toBe(ATTACKER_SESSION);
    expect(forwardedRaw()).not.toContain(VICTIM_SESSION);
  });

  it('preserves the other request fields (contract unchanged)', async () => {
    await POST(
      makeRequest({
        session_id: ATTACKER_SESSION,
        job_id: ATTACKER_SESSION,
        cam_run_id: 'run-1',
        parameters: { length: 10 },
      })
    );

    const sent = forwardedBody();
    expect(sent.cam_run_id).toBe('run-1');
    expect(sent.parameters).toEqual({ length: 10 });
  });

  it('still returns 403 and never calls the ai-engine for a session the caller does not own', async () => {
    const res = await POST(makeRequest({ session_id: VICTIM_SESSION, job_id: VICTIM_SESSION }));

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still returns 403 for a nonexistent session_id', async () => {
    const res = await POST(makeRequest({ session_id: 'does-not-exist', job_id: 'does-not-exist' }));

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('cannot bypass ownership by using an owned job_id with a foreign session_id', async () => {
    const res = await POST(makeRequest({ session_id: VICTIM_SESSION, job_id: ATTACKER_SESSION }));

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { job_id: VICTIM_SESSION, parameters: {} }],
    ['empty', { session_id: '', job_id: VICTIM_SESSION }],
    ['numeric', { session_id: 42, job_id: VICTIM_SESSION }],
    ['object', { session_id: { id: ATTACKER_SESSION }, job_id: VICTIM_SESSION }],
    ['null', { session_id: null, job_id: VICTIM_SESSION }],
  ])('rejects a %s session_id with 400 and forwards nothing (client job_id alone never reaches ai-engine)', async (_label, body) => {
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a non-object JSON body with 400 and forwards nothing', async () => {
    const res = await POST(makeRequest(null));

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still returns 401 when unauthenticated and forwards nothing', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest({ session_id: ATTACKER_SESSION, job_id: VICTIM_SESSION }));

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still returns 401 when the authenticated user no longer exists', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ session_id: ATTACKER_SESSION, job_id: VICTIM_SESSION }));

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
