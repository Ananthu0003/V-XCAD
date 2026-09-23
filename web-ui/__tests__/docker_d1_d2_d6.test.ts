/**
 * @jest-environment node
 *
 * Docker audit remediation — D-1 (hardcoded container_name), D-2 (ai-engine startup
 * dependency), D-6 (OPENROUTER_API_KEY wiring).
 *
 * Same two-layer approach as f3_postgres_hardening.test.ts:
 *  A. the compose file as parsed YAML;
 *  B. the REAL compose engine (`docker compose config`), skipped when docker is unavailable,
 *     so these assertions are against Compose's actual resolved output, not a reimplementation
 *     of its interpolation/merge semantics.
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require('child_process');

const REPO = path.resolve(process.cwd(), '..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');
const compose = yaml.load(read('docker-compose.yml'));
const services = compose.services as Record<string, any>;

// ═══════════════════════════════════════════════════════════════════════════
// A. Parsed YAML
// ═══════════════════════════════════════════════════════════════════════════

describe('A. D-1 — no hardcoded container_name on postgres/ai-engine/web-ui', () => {
  it.each(['postgres', 'ai-engine', 'web-ui'])('%s has no container_name key', (svc) => {
    expect(services[svc].container_name).toBeUndefined();
  });

  it('migrate still (already) has no container_name — regression guard', () => {
    expect(services.migrate.container_name).toBeUndefined();
  });

  it('no container_name appears anywhere in the raw file', () => {
    expect(read('docker-compose.yml')).not.toMatch(/container_name\s*:/);
  });

  it('service-to-service URLs reference Compose service names, not the removed literal container names', () => {
    const text = read('docker-compose.yml');
    expect(text).toMatch(/postgres:5432/);
    expect(text).toMatch(/ai-engine:8000/);
    expect(text).not.toMatch(/vexcad_postgres|vexcad_ai_engine|vexcad_web_ui/);
  });
});

describe('A. D-2 — ai-engine depends_on postgres and migrate', () => {
  it('ai-engine depends on postgres being healthy', () => {
    expect(services['ai-engine'].depends_on.postgres.condition).toBe('service_healthy');
  });

  it('ai-engine depends on migrate having completed successfully', () => {
    expect(services['ai-engine'].depends_on.migrate.condition).toBe('service_completed_successfully');
  });

  it('web-ui still depends on ai-engine, postgres, and migrate (regression guard — unchanged by this fix)', () => {
    expect(services['web-ui'].depends_on['ai-engine'].condition).toBe('service_healthy');
    expect(services['web-ui'].depends_on.postgres.condition).toBe('service_healthy');
    expect(services['web-ui'].depends_on.migrate.condition).toBe('service_completed_successfully');
  });

  it('no artificial sleep/wait was introduced', () => {
    expect(read('docker-compose.yml')).not.toMatch(/sleep\s+\d/);
  });

  it("ai-engine's healthcheck was not made heavier (unchanged endpoint/timing)", () => {
    const hc = services['ai-engine'].healthcheck;
    expect(hc.test).toEqual(['CMD', 'curl', '-f', 'http://localhost:8000/health']);
    expect(hc.interval).toBe('30s');
    expect(hc.retries).toBe(3);
    expect(hc.start_period).toBe('20s');
  });
});

describe('A. D-6 — OPENROUTER_API_KEY wired to ai-engine only, optional', () => {
  it('ai-engine environment references OPENROUTER_API_KEY', () => {
    const env = services['ai-engine'].environment;
    expect(env.OPENROUTER_API_KEY).toBe('${OPENROUTER_API_KEY}');
  });

  it('is NOT made mandatory with a `:?` guard (Google/OpenRouter both remain optional)', () => {
    expect(services['ai-engine'].environment.OPENROUTER_API_KEY).not.toMatch(/:\?/);
  });

  it('is not wired into web-ui or migrate (ai-engine only)', () => {
    expect(JSON.stringify(services['web-ui'].environment)).not.toContain('OPENROUTER_API_KEY');
    expect(JSON.stringify(services.migrate.environment)).not.toContain('OPENROUTER_API_KEY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. The real compose engine (skipped when docker is not installed)
// ═══════════════════════════════════════════════════════════════════════════

const dockerOk = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const describeDocker = dockerOk ? describe : describe.skip;

function renderCompose(extraEnv: Record<string, string>, files = ['docker-compose.yml']) {
  const args = ['compose'];
  for (const f of files) args.push('-f', path.join(REPO, f));
  args.push('--project-directory', REPO, '--env-file', '/dev/null', 'config', '--format', 'json');
  return spawnSync('docker', args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv } });
}

const FULL = {
  JWT_SECRET: 'j'.repeat(32),
  SERVICE_API_KEY: 's'.repeat(32),
  GOOGLE_API_KEY: 'g',
  POSTGRES_ADMIN_PASSWORD: 'A'.repeat(24),
  POSTGRES_APP_PASSWORD: 'B'.repeat(24),
};

describeDocker('B. real `docker compose config`', () => {
  it('D-1: resolved config has no container_name for postgres/ai-engine/web-ui, and Compose auto-generates project-scoped names', () => {
    const r = renderCompose(FULL);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('container_name');
    // Sanity: previously-hardcoded literal names must not leak in through any other route.
    expect(r.stdout).not.toMatch(/vexcad_postgres|vexcad_ai_engine|vexcad_web_ui/);
  });

  it('D-1: two independently-named Compose projects resolve without any name collision', () => {
    const a = renderCompose(FULL); // implicit project name from --project-directory
    const b = spawnSync(
      'docker',
      ['compose', '-f', path.join(REPO, 'docker-compose.yml'), '-p', 'vxjest_d1_test', '--env-file', '/dev/null', 'config', '--format', 'json'],
      { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...FULL } },
    );
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    const cfgA = JSON.parse(a.stdout);
    const cfgB = JSON.parse(b.stdout);
    // Different project names must produce different auto-generated network names — the
    // whole point of removing container_name is that nothing forces a global name clash.
    expect(cfgA.networks.db.name).not.toBe(cfgB.networks.db.name);
    expect(cfgB.networks.db.name).toBe('vxjest_d1_test_db');
  });

  it('D-2: resolved ai-engine depends_on has the exact health/readiness conditions', () => {
    const cfg = JSON.parse(renderCompose(FULL).stdout);
    expect(cfg.services['ai-engine'].depends_on).toEqual({
      postgres: { condition: 'service_healthy', required: true },
      migrate: { condition: 'service_completed_successfully', required: true },
    });
  });

  it('D-2: web-ui depends_on remains the full pre-existing set (regression guard)', () => {
    const cfg = JSON.parse(renderCompose(FULL).stdout);
    expect(Object.keys(cfg.services['web-ui'].depends_on).sort()).toEqual(['ai-engine', 'migrate', 'postgres']);
  });

  it('D-6: OPENROUTER_API_KEY resolves to empty string when unset — never required, never blocks startup', () => {
    const cfg = JSON.parse(renderCompose(FULL).stdout);
    expect(cfg.services['ai-engine'].environment.OPENROUTER_API_KEY).toBe('');
    expect(renderCompose(FULL).status).toBe(0);
  });

  it('D-6: OPENROUTER_API_KEY flows through correctly when configured, scoped to ai-engine only', () => {
    const withKey = { ...FULL, OPENROUTER_API_KEY: 'test-openrouter-key-value-not-a-real-secret' };
    const cfg = JSON.parse(renderCompose(withKey).stdout);
    expect(cfg.services['ai-engine'].environment.OPENROUTER_API_KEY).toBe('test-openrouter-key-value-not-a-real-secret');
    expect(JSON.stringify(cfg.services['web-ui'].environment)).not.toContain('OPENROUTER_API_KEY');
  });

  it('required secrets remain fail-closed after these changes (regression guard)', () => {
    for (const missing of ['POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'SERVICE_API_KEY', 'JWT_SECRET']) {
      const env = { ...FULL };
      delete (env as any)[missing];
      const r = renderCompose(env);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(missing);
    }
  });

  it('postgres still has no published port and the db network is still internal (regression guard)', () => {
    const cfg = JSON.parse(renderCompose(FULL).stdout);
    expect(cfg.services.postgres.ports ?? []).toEqual([]);
    expect(cfg.networks.db.internal).toBe(true);
  });

  it('the dev override still publishes postgres on loopback only (regression guard)', () => {
    const r = renderCompose(FULL, ['docker-compose.yml', 'docker-compose.dev.yml']);
    expect(r.status).toBe(0);
    const ports = JSON.parse(r.stdout).services.postgres.ports;
    expect(ports).toHaveLength(1);
    expect(ports[0].host_ip).toBe('127.0.0.1');
  });
});
