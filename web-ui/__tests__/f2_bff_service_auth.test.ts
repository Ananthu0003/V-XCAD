/**
 * @jest-environment node
 *
 * Finding 2 (P2) — BFF -> ai-engine service authentication.
 *
 * Browser -> Next.js BFF (user auth + ownership) -> X-Service-Key -> ai-engine
 *
 * Proves that:
 *  1. the shared helper attaches the key, fails closed without it, and discards any
 *     caller-supplied credential;
 *  2. every one of the 14 BFF -> engine call sites goes through that helper;
 *  3. user authentication / ownership is still enforced BEFORE any engine call;
 *  4. the key cannot reach the browser (static guards).
 */

export {};

const KEY = 'bff-test-service-key-9f2c';
process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGetSession = jest.fn();
const mockRequireSession = jest.fn();
const mockRequireAdmin = jest.fn();
jest.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
  requireSession: (...a: unknown[]) => mockRequireSession(...a),
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));

const mockUserFindUnique = jest.fn();
const mockCadSessionFindUnique = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    cadSession: {
      findUnique: (...a: unknown[]) => mockCadSessionFindUnique(...a),
      create: jest.fn().mockResolvedValue({ id: 'new-session' }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { aiEngineFetch, getServiceApiKey, AiEngineAuthConfigError } = require('@/lib/aiEngine');

const ok = () =>
  new Response(JSON.stringify({ status: 'ok', documents: [], features: [], simulationRunId: 'r', simulationRun: {}, setup: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SERVICE_API_KEY = KEY;
  process.env.FASTAPI_URL = 'http://ai-engine:8000/api/v1';
  mockFetch.mockImplementation(async () => ok());
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The shared helper
// ═══════════════════════════════════════════════════════════════════════════

describe('aiEngineFetch() — shared service-auth helper', () => {
  it('attaches X-Service-Key and preserves method, body and other headers', async () => {
    await aiEngineFetch('http://ai-engine:8000/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{"a":1}',
      cache: 'no-store',
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://ai-engine:8000/api/v1/x');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'X-Service-Key': KEY,
    });
  });

  it('works when no headers are supplied at all', async () => {
    await aiEngineFetch('http://ai-engine:8000/api/v1/x');
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ 'X-Service-Key': KEY });
  });

  it('accepts Headers instances and tuple arrays', async () => {
    await aiEngineFetch('http://e/x', { headers: new Headers({ accept: 'text/event-stream' }) });
    await aiEngineFetch('http://e/x', { headers: [['accept', 'application/json']] });

    expect(mockFetch.mock.calls[0][1].headers).toEqual({ accept: 'text/event-stream', 'X-Service-Key': KEY });
    expect(mockFetch.mock.calls[1][1].headers).toEqual({ accept: 'application/json', 'X-Service-Key': KEY });
  });

  it.each([
    ['exact case', { 'X-Service-Key': 'attacker' }],
    ['lower case', { 'x-service-key': 'attacker' }],
    ['upper case', { 'X-SERVICE-KEY': 'attacker' }],
  ])('discards a caller-supplied credential (%s) and sends only the configured one', async (_l, hdrs) => {
    await aiEngineFetch('http://e/x', { headers: hdrs });

    const sent = mockFetch.mock.calls[0][1].headers;
    const keys = Object.keys(sent).filter((k) => k.toLowerCase() === 'x-service-key');
    expect(keys).toHaveLength(1);
    expect(sent[keys[0]]).toBe(KEY);
    expect(JSON.stringify(sent)).not.toContain('attacker');
  });

  it('discards a caller-supplied credential inside a Headers instance and tuple array', async () => {
    await aiEngineFetch('http://e/x', { headers: new Headers({ 'X-Service-Key': 'attacker' }) });
    await aiEngineFetch('http://e/x', { headers: [['x-service-key', 'attacker']] });
    for (const c of mockFetch.mock.calls) {
      expect(JSON.stringify(c[1].headers)).not.toContain('attacker');
      expect(c[1].headers['X-Service-Key']).toBe(KEY);
    }
  });

  it('does not mutate the caller-supplied init or headers object', async () => {
    const headers = { accept: 'application/json' };
    const init = { method: 'GET', headers };
    await aiEngineFetch('http://e/x', init);
    expect(headers).toEqual({ accept: 'application/json' });
    expect(init.headers).toBe(headers);
  });

  it('trims surrounding whitespace from the configured key', async () => {
    process.env.SERVICE_API_KEY = `  ${KEY}\n`;
    await aiEngineFetch('http://e/x');
    expect(mockFetch.mock.calls[0][1].headers['X-Service-Key']).toBe(KEY);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('FAILS CLOSED when SERVICE_API_KEY is %s: rejects and makes no network request', async (_l, value) => {
    if (value === undefined) delete process.env.SERVICE_API_KEY;
    else process.env.SERVICE_API_KEY = value;

    await expect(aiEngineFetch('http://e/x')).rejects.toBeInstanceOf(AiEngineAuthConfigError);
    expect(() => getServiceApiKey()).toThrow(AiEngineAuthConfigError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('the configuration error does not disclose the variable name or any secret', () => {
    delete process.env.SERVICE_API_KEY;
    let msg = '';
    try { getServiceApiKey(); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/SERVICE_API_KEY/);
    expect(msg).not.toContain(KEY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 + 3. Every call site sends the key; user auth is still enforced first
// ═══════════════════════════════════════════════════════════════════════════

const json = (body: unknown) => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const form = (fields: Record<string, string>, file?: File) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set('file', file);
  return { body: fd, headers: {} };
};
const P = (o: Record<string, string>) => ({ params: Promise.resolve(o) });

type Site = {
  name: string;
  route: string;
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  init: () => { body?: BodyInit; headers: Record<string, string> };
  ctx?: unknown;
  engineUrl: string;
  unauthStatus: number;
};

const SITES: Site[] = [
  { name: 'render', route: '@/app/api/render/route', method: 'POST', url: '/api/render',
    init: () => json({ python_script: 'x=1', parameters: {}, session_id: 's1' }), engineUrl: '/render', unauthStatus: 401 },
  { name: 'generate', route: '@/app/api/generate/route', method: 'POST', url: '/api/generate',
    init: () => form({ prompt: 'a box', session_id: 's1' }), engineUrl: '/generate', unauthStatus: 401 },
  { name: 'cam/analyze', route: '@/app/api/cam/analyze/route', method: 'POST', url: '/api/cam/analyze',
    init: () => json({ session_id: 's1', parameters: {} }), engineUrl: '/cam/analyze', unauthStatus: 401 },
  { name: 'cam/auto-plan', route: '@/app/api/cam/auto-plan/route', method: 'POST', url: '/api/cam/auto-plan',
    init: () => json({ session_id: 's1', parameters: {} }), engineUrl: '/cam/auto_plan', unauthStatus: 401 },
  { name: 'cam/toolpaths', route: '@/app/api/cam/toolpaths/route', method: 'POST', url: '/api/cam/toolpaths',
    init: () => json({ session_id: 's1' }), engineUrl: '/cam/toolpaths', unauthStatus: 401 },
  { name: 'cam/gcode', route: '@/app/api/cam/gcode/route', method: 'POST', url: '/api/cam/gcode',
    init: () => json({ session_id: 's1' }), engineUrl: '/cam/gcode', unauthStatus: 401 },
  { name: 'cam/recommend-machine', route: '@/app/api/cam/recommend-machine/route', method: 'POST', url: '/api/cam/recommend-machine',
    init: () => json({ features: [] }), engineUrl: '/cam/recommend-machine', unauthStatus: 401 },
  { name: 'cam/simulate/prepare', route: '@/app/api/cam/[jobId]/simulate/prepare/route', method: 'POST', url: '/api/cam/s1/simulate/prepare',
    init: () => json({ setup: {}, operations: [] }), ctx: P({ jobId: 's1' }), engineUrl: '/cam/simulate/prepare', unauthStatus: 401 },
  { name: 'assistant/compare', route: '@/app/api/assistant/compare/route', method: 'POST', url: '/api/assistant/compare',
    init: () => json({ message: 'hi' }), engineUrl: '/assistant/compare-and-prompt', unauthStatus: 401 },
  { name: 'blueprint', route: '@/app/api/blueprint/[id]/route', method: 'GET', url: '/api/blueprint/s1',
    init: () => ({ headers: {} }), ctx: P({ id: 's1' }), engineUrl: '/api/v1/blueprint/s1', unauthStatus: 401 },
  { name: 'knowledge/documents', route: '@/app/api/knowledge/documents/route', method: 'GET', url: '/api/knowledge/documents',
    init: () => ({ headers: {} }), engineUrl: '/knowledge/documents', unauthStatus: 403 },
  { name: 'knowledge/ingest', route: '@/app/api/knowledge/documents/ingest/route', method: 'POST', url: '/api/knowledge/documents/ingest',
    init: () => form({}, new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })), engineUrl: '/knowledge/documents/ingest', unauthStatus: 403 },
  { name: 'knowledge/retrieve', route: '@/app/api/knowledge/retrieve/route', method: 'POST', url: '/api/knowledge/retrieve',
    init: () => json({ query: 'q' }), engineUrl: '/knowledge/retrieve', unauthStatus: 403 },
  { name: 'knowledge/delete', route: '@/app/api/knowledge/documents/[docId]/route', method: 'DELETE', url: '/api/knowledge/documents/doc-1',
    init: () => ({ headers: {} }), ctx: P({ docId: 'doc-1' }), engineUrl: '/knowledge/documents/doc-1', unauthStatus: 403 },
];

function authenticate(yes: boolean) {
  mockGetSession.mockResolvedValue(yes ? { userId: 'u1', email: 'u@test.com', tokenVersion: 0 } : null);
  mockRequireSession.mockResolvedValue(yes ? 'u1' : null);
  mockRequireAdmin.mockResolvedValue(yes ? 'u1' : null);
  mockUserFindUnique.mockResolvedValue(yes ? { id: 'u1' } : null);
  mockCadSessionFindUnique.mockResolvedValue({ userId: 'u1', isShared: false });
}

async function invoke(site: Site) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const handler = require(site.route)[site.method];
  const { body, headers } = site.init();
  const req = new Request(`http://localhost:3000${site.url}`, { method: site.method, headers, body });
  return handler(req, site.ctx);
}

describe.each(SITES)('BFF call site: $name', (site) => {
  it('sends X-Service-Key (from server env) to the engine URL it targets', async () => {
    authenticate(true);

    await invoke(site);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(`http://ai-engine:8000${site.engineUrl.startsWith('/api/v1') ? '' : '/api/v1'}${site.engineUrl}`);
    expect(init.headers['X-Service-Key']).toBe(KEY);
  });

  it('never sends the key when a client tries to supply its own credential header', async () => {
    authenticate(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const handler = require(site.route)[site.method];
    const { body, headers } = site.init();
    const req = new Request(`http://localhost:3000${site.url}`, {
      method: site.method, body, headers: { ...headers, 'X-Service-Key': 'client-supplied', 'x-service-key': 'client-supplied-2' },
    });

    await handler(req, site.ctx);

    for (const c of mockFetch.mock.calls) {
      expect(JSON.stringify(c[1].headers)).not.toContain('client-supplied');
    }
  });

  it('FAILS CLOSED with no engine request when the server key is not configured', async () => {
    authenticate(true);
    delete process.env.SERVICE_API_KEY;

    const res = await invoke(site);

    expect(mockFetch).not.toHaveBeenCalled();
    expect([500, 502]).toContain(res.status);
    expect(await res.text()).not.toContain(KEY);
  });

  it('still enforces user authentication BEFORE calling the engine', async () => {
    authenticate(false);

    const res = await invoke(site);

    expect(res.status).toBe(site.unauthStatus);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never leaks the service key in an error response', async () => {
    authenticate(true);
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED 172.19.0.4:8000'));

    const res = await invoke(site);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain(KEY);
  });
});

describe('existing ownership checks are untouched', () => {
  it('CAM routes still 403 (and never call the engine) for a session the caller does not own', async () => {
    authenticate(true);
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'someone-else' });

    for (const s of SITES.filter((x) => x.name.startsWith('cam/') && x.name !== 'cam/recommend-machine' && x.name !== 'cam/simulate/prepare')) {
      const res = await invoke(s);
      expect(res.status).toBe(403);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blueprint and render still 403 for a foreign private session', async () => {
    authenticate(true);
    mockCadSessionFindUnique.mockResolvedValue({ userId: 'someone-else', isShared: false });

    expect((await invoke(SITES.find((s) => s.name === 'blueprint')!)).status).toBe(403);
    expect((await invoke(SITES.find((s) => s.name === 'render')!)).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('knowledge routes still require an ADMIN (a plain user is rejected before the engine)', async () => {
    authenticate(true);
    mockRequireAdmin.mockResolvedValue(null); // logged in, but not admin

    for (const s of SITES.filter((x) => x.name.startsWith('knowledge/'))) {
      expect((await invoke(s)).status).toBe(403);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The key cannot reach the browser (static guards over the source tree)
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__', '.git', 'public'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = ['app', 'components', 'lib', 'store', 'types', 'proxy.ts', 'next.config.ts']
  .map((p) => path.join(ROOT, p))
  .filter((p) => fs.existsSync(p))
  .flatMap((p) => (fs.statSync(p).isDirectory() ? walk(p) : [p]));
const rel = (p: string) => path.relative(ROOT, p);

describe('static guards — the service key is server-only', () => {
  it('scans a non-trivial source tree (guards against an empty glob)', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it('SERVICE_API_KEY is referenced only by the shared helper', () => {
    const users = SOURCES.filter((f) => fs.readFileSync(f, 'utf8').includes('SERVICE_API_KEY')).map(rel);
    expect(users).toEqual(['lib/aiEngine.ts']);
  });

  it('the X-Service-Key header name is set only by the shared helper', () => {
    const users = SOURCES.filter((f) => /x-service-key/i.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(users).toEqual(['lib/aiEngine.ts']);
  });

  it('no NEXT_PUBLIC_* variable names a service key, database URL or password', () => {
    const bad = SOURCES.filter((f) => /NEXT_PUBLIC_[A-Z0-9_]*(SERVICE|DATABASE|DB_|POSTGRES|PASSWORD|SECRET|API_KEY)/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(bad).toEqual([]);
  });

  it('next.config.ts does not inline server env into the client bundle', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/\benv\s*:\s*\{/);
    expect(cfg).not.toMatch(/SERVICE_API_KEY/);
  });

  it("no client component ('use client') imports the engine helper", () => {
    const clientFiles = SOURCES.filter((f) => /^\s*['"]use client['"]/m.test(fs.readFileSync(f, 'utf8').slice(0, 400)));
    expect(clientFiles.length).toBeGreaterThan(20);
    const offenders = clientFiles.filter((f) => /@\/lib\/aiEngine|lib\/aiEngine/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('nothing under components/ imports the engine helper', () => {
    const offenders = SOURCES.filter((f) => rel(f).startsWith('components/'))
      .filter((f) => /aiEngine/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('only server route handlers / server code import the helper', () => {
    const importers = SOURCES.filter((f) => /from ['"]@\/lib\/aiEngine['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(importers.length).toBe(14);
    for (const f of importers) expect(f).toMatch(/^app\/api\/.+\/route\.ts$/);
  });

  it('every route that talks to the engine uses aiEngineFetch and contains no raw fetch()', () => {
    const engineRoutes = SOURCES.filter((f) => /^app\/api\/.+\/route\.ts$/.test(rel(f)))
      .filter((f) => /FASTAPI_URL|getFastApiUrl/.test(fs.readFileSync(f, 'utf8')));
    expect(engineRoutes.length).toBe(14);
    for (const f of engineRoutes) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).toContain('aiEngineFetch(');
      expect(src.replace(/aiEngineFetch\(/g, '')).not.toMatch(/(^|[^.\w])fetch\(/m);
    }
  });
});
