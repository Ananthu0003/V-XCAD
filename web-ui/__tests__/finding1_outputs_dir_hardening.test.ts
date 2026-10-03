/**
 * @jest-environment node
 *
 * Finding 1 (P3) — tracked outputs/ artifacts + autoSyncDiskSessions hardening.
 *
 * Regression coverage for lib/outputsDir.ts and app/api/sessions/route.ts's
 * autoSyncDiskSessions(): the sync must use ONLY the application's real runtime
 * output location (/app/outputs, the shared Docker volume mount), never a
 * process.cwd()-relative guess such as '../outputs' (which, in local development,
 * silently resolved to the repository's own tracked outputs/ directory).
 */

// ── Polyfill Request/Response/Headers (same shape as vex009_session_auth.test.ts) ──

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
  };
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(public body?: BodyInit | null, public init?: ResponseInit) {
      this.status = init?.status || 200;
      this.headers = new Headers(init?.headers);
    }
    status: number;
    headers: Headers;
    async json() { return JSON.parse(this.body as string); }
  };
}

if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    private map = new Map<string, string>();
    get(name: string) { return this.map.get(name.toLowerCase()) || null; }
    set(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
  };
}

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(data: any, init?: { status?: number }) {
      return new Response(JSON.stringify(data), { status: init?.status || 200 });
    }
  }
  return { NextResponse: MockNextResponse };
});

const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockCadSessionFindUnique = jest.fn();
const mockCadSessionFindMany = jest.fn();
const mockCadSessionCreate = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
      findMany: (...args: unknown[]) => mockCadSessionFindMany(...args),
      create: (...args: unknown[]) => mockCadSessionCreate(...args),
    },
  },
}));

const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockStatSync = jest.fn();
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

const AUTH_USER = { userId: 'user-1', email: 'user@test.com' };

describe('lib/outputsDir — resolveOutputsDir()', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('OUTPUTS_DIR is the fixed application runtime path, not cwd-derived', () => {
    const { OUTPUTS_DIR } = require('@/lib/outputsDir');
    expect(OUTPUTS_DIR).toBe('/app/outputs');
  });

  it('returns the path when it exists on disk', () => {
    mockExistsSync.mockReturnValue(true);
    const { resolveOutputsDir, OUTPUTS_DIR } = require('@/lib/outputsDir');
    expect(resolveOutputsDir()).toBe(OUTPUTS_DIR);
    expect(mockExistsSync).toHaveBeenCalledWith('/app/outputs');
  });

  it('fails safe (returns null) when the runtime output directory is absent', () => {
    mockExistsSync.mockReturnValue(false);
    const { resolveOutputsDir } = require('@/lib/outputsDir');
    expect(resolveOutputsDir()).toBeNull();
  });

  it('fails safe (returns null) if the existence check itself throws', () => {
    mockExistsSync.mockImplementation(() => { throw new Error('EACCES'); });
    const { resolveOutputsDir } = require('@/lib/outputsDir');
    expect(() => resolveOutputsDir()).not.toThrow();
    expect(resolveOutputsDir()).toBeNull();
  });
});

describe('GET /api/sessions — autoSyncDiskSessions only trusts the real runtime output dir', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(AUTH_USER);
    mockCadSessionFindMany.mockResolvedValue([]);
  });

  it('never queries a cwd-relative candidate (e.g. "../outputs") for existence', async () => {
    mockExistsSync.mockReturnValue(false);

    const { GET } = require('@/app/api/sessions/route');
    await GET();

    const checkedPaths = mockExistsSync.mock.calls.map((c) => c[0]);
    expect(checkedPaths).not.toEqual(
      expect.arrayContaining([expect.stringContaining('..')])
    );
    // Every existsSync probe from the sync must be the one fixed runtime path.
    for (const p of checkedPaths) {
      expect(p).toBe('/app/outputs');
    }
  });

  it('does not read or import anything when the runtime output dir is absent (fail safe)', async () => {
    mockExistsSync.mockReturnValue(false);

    const { GET } = require('@/app/api/sessions/route');
    await GET();

    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockCadSessionCreate).not.toHaveBeenCalled();
  });

  it('a stray directory at a non-runtime path (e.g. repo outputs/) is never consulted', async () => {
    // Simulate a filesystem where only a cwd-relative path exists, but /app/outputs
    // does not. Old behaviour would have picked this up; hardened behaviour must not.
    mockExistsSync.mockImplementation((p: string) => p !== '/app/outputs');
    mockReaddirSync.mockReturnValue(['cad_stray-session.py']);

    const { GET } = require('@/app/api/sessions/route');
    await GET();

    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockCadSessionCreate).not.toHaveBeenCalled();
  });

  it('when /app/outputs exists, sync reads only from that directory and imports orphaned scripts', async () => {
    mockExistsSync.mockImplementation((p: string) => p === '/app/outputs');
    mockReaddirSync.mockReturnValue(['cad_new-session.py']);
    mockReadFileSync.mockReturnValue('PARAMETERS = {}\n');
    mockStatSync.mockReturnValue({ mtime: new Date('2026-01-01') });
    mockCadSessionFindUnique.mockResolvedValue(null);
    mockCadSessionCreate.mockResolvedValue({});

    const { GET } = require('@/app/api/sessions/route');
    await GET();

    expect(mockReaddirSync).toHaveBeenCalledWith('/app/outputs');
    expect(mockCadSessionCreate).toHaveBeenCalledTimes(1);
    const created = mockCadSessionCreate.mock.calls[0][0].data;
    expect(created.id).toBe('new-session');
  });

  it('does not re-import a script whose session already exists', async () => {
    mockExistsSync.mockImplementation((p: string) => p === '/app/outputs');
    mockReaddirSync.mockReturnValue(['cad_existing-session.py']);
    mockCadSessionFindUnique.mockResolvedValue({ id: 'existing-session' });

    const { GET } = require('@/app/api/sessions/route');
    await GET();

    expect(mockCadSessionCreate).not.toHaveBeenCalled();
  });
});
