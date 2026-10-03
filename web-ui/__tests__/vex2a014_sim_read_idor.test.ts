/**
 * VEX-2A-014 Regression Tests — Simulation Read Authorization / Nested Resource IDOR
 *
 * Verifies that an authenticated user cannot read another user's simulation data
 * through GET /api/cam/[jobId]/simulation/[simulationRunId] and its child endpoints.
 *
 * Fix: Verify SimulationRun.job_id matches the supplied jobId, then authorize
 * the parent CadSession (owner / shared / null-user semantics).
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
    delete(name: string) { return this.map.delete(name.toLowerCase()); }
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

const mockRequireSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  requireSession: (...args: unknown[]) => mockRequireSession(...args),
}));

const mockUserFindUnique = jest.fn();
const mockCadSessionFindUnique = jest.fn();
const mockSimulationRunFindUnique = jest.fn();
const mockToolpathSegmentFindMany = jest.fn();
const mockToolpathSegmentCount = jest.fn();
const mockSimulationEventFindMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    cadSession: {
      findUnique: (...args: unknown[]) => mockCadSessionFindUnique(...args),
    },
    simulationRun: {
      findUnique: (...args: unknown[]) => mockSimulationRunFindUnique(...args),
    },
    toolpathSegment: {
      findMany: (...args: unknown[]) => mockToolpathSegmentFindMany(...args),
      count: (...args: unknown[]) => mockToolpathSegmentCount(...args),
    },
    simulationEvent: {
      findMany: (...args: unknown[]) => mockSimulationEventFindMany(...args),
    },
  },
}));

// ── Import route modules ───────────────────────────────────────────────────

const simRoute = require('@/app/api/cam/[jobId]/simulation/[simulationRunId]/route');
const segmentsRoute = require('@/app/api/cam/[jobId]/simulation/[simulationRunId]/segments/route');
const timelineRoute = require('@/app/api/cam/[jobId]/simulation/[simulationRunId]/timeline/route');

const { GET: getSimulation } = simRoute;
const { GET: getSegments } = segmentsRoute;
const { GET: getTimeline } = timelineRoute;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

function params(jobId: string, simulationRunId: string) {
  return Promise.resolve({ jobId, simulationRunId });
}

const SIM_RUN_DATA = {
  id: 'sim-run-123',
  job_id: 'job-owner-123',
  setup: { id: 'setup-1', stock_length: 100 },
  segments: [{ id: 'seg-1', segment_index: 0 }],
};

const SEGMENT_DATA = [
  { id: 'seg-1', simulation_run_id: 'sim-run-123', segment_index: 0 },
  { id: 'seg-2', simulation_run_id: 'sim-run-123', segment_index: 1 },
];

const TIMELINE_DATA = [
  { id: 'evt-1', simulation_run_id: 'sim-run-123', time_sec: 0 },
  { id: 'evt-2', simulation_run_id: 'sim-run-123', time_sec: 1.5 },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VEX-2A-014 — Simulation read authorization / nested resource IDOR', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /api/cam/[jobId]/simulation/[simulationRunId]
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /api/cam/[jobId]/simulation/[simulationRunId]', () => {

    it('returns 401 when unauthenticated', async () => {
      mockRequireSession.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-1/simulation/sim-1');
      const res = await getSimulation(req, { params: params('job-1', 'sim-1') });

      expect(res.status).toBe(401);
      expect(mockSimulationRunFindUnique).not.toHaveBeenCalled();
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    });

    it('returns 200 when owner requests own simulation with correct jobId', async () => {
      mockRequireSession.mockResolvedValue('user-owner');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-owner-123/simulation/sim-run-123');
      const res = await getSimulation(req, { params: params('job-owner-123', 'sim-run-123') });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.simulationRun.id).toBe('sim-run-123');
    });

    it('returns 403 when non-owner requests another user\'s private simulation', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-owner-123/simulation/sim-run-123');
      const res = await getSimulation(req, { params: params('job-owner-123', 'sim-run-123') });

      expect(res.status).toBe(403);
    });

    it('returns 200 when user requests shared session simulation', async () => {
      mockRequireSession.mockResolvedValue('user-other');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-shared-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: true });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-shared-123/simulation/sim-run-123');
      const res = await getSimulation(req, { params: params('job-shared-123', 'sim-run-123') });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('returns 403 when user requests null-user/legacy session simulation', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-null-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: null, isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-null-123/simulation/sim-run-123');
      const res = await getSimulation(req, { params: params('job-null-123', 'sim-run-123') });

      expect(res.status).toBe(403);
    });

    it('returns 404 when CadSession/jobId does not exist', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-nonexistent' });
      mockCadSessionFindUnique.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-nonexistent/simulation/sim-run-123');
      const res = await getSimulation(req, { params: params('job-nonexistent', 'sim-run-123') });

      expect(res.status).toBe(404);
    });

    it('returns 404 when simulationRunId does not exist', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockSimulationRunFindUnique.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-1/simulation/sim-nonexistent');
      const res = await getSimulation(req, { params: params('job-1', 'sim-nonexistent') });

      expect(res.status).toBe(404);
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    });

    it('returns 403 when simulationRunId belongs to a different jobId', async () => {
      mockRequireSession.mockResolvedValue('user-a');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, id: 'sim-run-B', job_id: 'job-B' });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-A/simulation/sim-run-B');
      const res = await getSimulation(req, { params: params('job-A', 'sim-run-B') });

      expect(res.status).toBe(403);
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
    });

    it('returns 403 when non-owner uses correct victim jobId + victim simulationRunId', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-victim' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-victim/simulation/sim-run-victim');
      const res = await getSimulation(req, { params: params('job-victim', 'sim-run-victim') });

      expect(res.status).toBe(403);
    });

    it('performs authorization before returning simulation data', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ ...SIM_RUN_DATA, job_id: 'job-victim' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-victim/simulation/sim-run-victim');
      const res = await getSimulation(req, { params: params('job-victim', 'sim-run-victim') });

      expect(res.status).toBe(403);
      expect(mockSimulationRunFindUnique).toHaveBeenCalledTimes(1);
      expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
      const text = await res.text();
      expect(text).not.toContain('segments');
    });

    it('blocks User A from reading User B simulation with mismatched IDs', async () => {
      mockRequireSession.mockResolvedValue('user-a');

      const scenario1 = makeGetRequest('http://localhost:3000/api/cam/job-A/simulation/sim-B');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-B', job_id: 'job-B' });
      const res1 = await getSimulation(scenario1, { params: params('job-A', 'sim-B') });
      expect(res1.status).toBe(403);

      const scenario2 = makeGetRequest('http://localhost:3000/api/cam/job-B/simulation/sim-A');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-A', job_id: 'job-A' });
      const res2 = await getSimulation(scenario2, { params: params('job-B', 'sim-A') });
      expect(res2.status).toBe(403);

      const scenario3 = makeGetRequest('http://localhost:3000/api/cam/random-job/simulation/sim-B');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-B', job_id: 'job-B' });
      const res3 = await getSimulation(scenario3, { params: params('random-job', 'sim-B') });
      expect(res3.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /api/cam/[jobId]/simulation/[simulationRunId]/segments
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /api/cam/[jobId]/simulation/[simulationRunId]/segments', () => {

    it('returns 401 when unauthenticated', async () => {
      mockRequireSession.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-1/simulation/sim-1/segments');
      const res = await getSegments(req, { params: params('job-1', 'sim-1') });

      expect(res.status).toBe(401);
      expect(mockSimulationRunFindUnique).not.toHaveBeenCalled();
    });

    it('returns 200 when owner requests own segments with correct jobId', async () => {
      mockRequireSession.mockResolvedValue('user-owner');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: false });
      mockToolpathSegmentFindMany.mockResolvedValue(SEGMENT_DATA);
      mockToolpathSegmentCount.mockResolvedValue(2);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-owner-123/simulation/sim-run-123/segments');
      const res = await getSegments(req, { params: params('job-owner-123', 'sim-run-123') });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.segments).toHaveLength(2);
    });

    it('returns 403 when non-owner requests another user\'s segments', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-owner-123/simulation/sim-run-123/segments');
      const res = await getSegments(req, { params: params('job-owner-123', 'sim-run-123') });

      expect(res.status).toBe(403);
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
      expect(mockToolpathSegmentCount).not.toHaveBeenCalled();
    });

    it('returns 200 when user requests shared session segments', async () => {
      mockRequireSession.mockResolvedValue('user-other');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-shared-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: true });
      mockToolpathSegmentFindMany.mockResolvedValue(SEGMENT_DATA);
      mockToolpathSegmentCount.mockResolvedValue(2);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-shared-123/simulation/sim-run-123/segments');
      const res = await getSegments(req, { params: params('job-shared-123', 'sim-run-123') });

      expect(res.status).toBe(200);
    });

    it('returns 403 when user requests null-user/legacy session segments', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-null-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: null, isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-null-123/simulation/sim-run-123/segments');
      const res = await getSegments(req, { params: params('job-null-123', 'sim-run-123') });

      expect(res.status).toBe(403);
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
    });

    it('returns 404 when CadSession/jobId does not exist', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-nonexistent' });
      mockCadSessionFindUnique.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-nonexistent/simulation/sim-run-123/segments');
      const res = await getSegments(req, { params: params('job-nonexistent', 'sim-run-123') });

      expect(res.status).toBe(404);
    });

    it('returns 404 when simulationRunId does not exist', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockSimulationRunFindUnique.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-1/simulation/sim-nonexistent/segments');
      const res = await getSegments(req, { params: params('job-1', 'sim-nonexistent') });

      expect(res.status).toBe(404);
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
    });

    it('returns 403 when simulationRunId belongs to a different jobId', async () => {
      mockRequireSession.mockResolvedValue('user-a');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-B', job_id: 'job-B' });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-A/simulation/sim-run-B/segments');
      const res = await getSegments(req, { params: params('job-A', 'sim-run-B') });

      expect(res.status).toBe(403);
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
    });

    it('returns 403 when non-owner uses correct victim jobId + victim simulationRunId', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-victim', job_id: 'job-victim' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-victim/simulation/sim-run-victim/segments');
      const res = await getSegments(req, { params: params('job-victim', 'sim-run-victim') });

      expect(res.status).toBe(403);
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
    });

    it('rejects before querying child resources (authorization ordering)', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-victim', job_id: 'job-victim' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-victim/simulation/sim-run-victim/segments');
      const res = await getSegments(req, { params: params('job-victim', 'sim-run-victim') });

      expect(res.status).toBe(403);
      expect(mockSimulationRunFindUnique).toHaveBeenCalledTimes(1);
      expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
      expect(mockToolpathSegmentCount).not.toHaveBeenCalled();
    });

    it('blocks cross-user ToolpathSegment exposure via mismatched IDs', async () => {
      mockRequireSession.mockResolvedValue('user-a');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-B', job_id: 'job-B' });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-A/simulation/sim-B/segments');
      const res = await getSegments(req, { params: params('job-A', 'sim-B') });

      expect(res.status).toBe(403);
      expect(mockToolpathSegmentFindMany).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /api/cam/[jobId]/simulation/[simulationRunId]/timeline
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /api/cam/[jobId]/simulation/[simulationRunId]/timeline', () => {

    it('returns 401 when unauthenticated', async () => {
      mockRequireSession.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-1/simulation/sim-1/timeline');
      const res = await getTimeline(req, { params: params('job-1', 'sim-1') });

      expect(res.status).toBe(401);
      expect(mockSimulationRunFindUnique).not.toHaveBeenCalled();
    });

    it('returns 200 when owner requests own timeline with correct jobId', async () => {
      mockRequireSession.mockResolvedValue('user-owner');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: false });
      mockSimulationEventFindMany.mockResolvedValue(TIMELINE_DATA);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-owner-123/simulation/sim-run-123/timeline');
      const res = await getTimeline(req, { params: params('job-owner-123', 'sim-run-123') });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.events).toHaveLength(2);
    });

    it('returns 403 when non-owner requests another user\'s timeline', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-owner-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-owner-123/simulation/sim-run-123/timeline');
      const res = await getTimeline(req, { params: params('job-owner-123', 'sim-run-123') });

      expect(res.status).toBe(403);
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });

    it('returns 200 when user requests shared session timeline', async () => {
      mockRequireSession.mockResolvedValue('user-other');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-shared-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-owner', isShared: true });
      mockSimulationEventFindMany.mockResolvedValue(TIMELINE_DATA);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-shared-123/simulation/sim-run-123/timeline');
      const res = await getTimeline(req, { params: params('job-shared-123', 'sim-run-123') });

      expect(res.status).toBe(200);
    });

    it('returns 403 when user requests null-user/legacy session timeline', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-null-123' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: null, isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-null-123/simulation/sim-run-123/timeline');
      const res = await getTimeline(req, { params: params('job-null-123', 'sim-run-123') });

      expect(res.status).toBe(403);
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });

    it('returns 404 when CadSession/jobId does not exist', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-123', job_id: 'job-nonexistent' });
      mockCadSessionFindUnique.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-nonexistent/simulation/sim-run-123/timeline');
      const res = await getTimeline(req, { params: params('job-nonexistent', 'sim-run-123') });

      expect(res.status).toBe(404);
    });

    it('returns 404 when simulationRunId does not exist', async () => {
      mockRequireSession.mockResolvedValue('user-1');
      mockSimulationRunFindUnique.mockResolvedValue(null);

      const req = makeGetRequest('http://localhost:3000/api/cam/job-1/simulation/sim-nonexistent/timeline');
      const res = await getTimeline(req, { params: params('job-1', 'sim-nonexistent') });

      expect(res.status).toBe(404);
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });

    it('returns 403 when simulationRunId belongs to a different jobId', async () => {
      mockRequireSession.mockResolvedValue('user-a');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-B', job_id: 'job-B' });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-A/simulation/sim-run-B/timeline');
      const res = await getTimeline(req, { params: params('job-A', 'sim-run-B') });

      expect(res.status).toBe(403);
      expect(mockCadSessionFindUnique).not.toHaveBeenCalled();
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });

    it('returns 403 when non-owner uses correct victim jobId + victim simulationRunId', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-victim', job_id: 'job-victim' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-victim/simulation/sim-run-victim/timeline');
      const res = await getTimeline(req, { params: params('job-victim', 'sim-run-victim') });

      expect(res.status).toBe(403);
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });

    it('rejects before querying child resources (authorization ordering)', async () => {
      mockRequireSession.mockResolvedValue('user-attacker');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-run-victim', job_id: 'job-victim' });
      mockCadSessionFindUnique.mockResolvedValue({ userId: 'user-victim', isShared: false });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-victim/simulation/sim-run-victim/timeline');
      const res = await getTimeline(req, { params: params('job-victim', 'sim-run-victim') });

      expect(res.status).toBe(403);
      expect(mockSimulationRunFindUnique).toHaveBeenCalledTimes(1);
      expect(mockCadSessionFindUnique).toHaveBeenCalledTimes(1);
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });

    it('blocks cross-user SimulationEvent exposure via mismatched IDs', async () => {
      mockRequireSession.mockResolvedValue('user-a');
      mockSimulationRunFindUnique.mockResolvedValue({ id: 'sim-B', job_id: 'job-B' });

      const req = makeGetRequest('http://localhost:3000/api/cam/job-A/simulation/sim-B/timeline');
      const res = await getTimeline(req, { params: params('job-A', 'sim-B') });

      expect(res.status).toBe(403);
      expect(mockSimulationEventFindMany).not.toHaveBeenCalled();
    });
  });
});
