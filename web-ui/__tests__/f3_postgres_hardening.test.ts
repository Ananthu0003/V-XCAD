/**
 * @jest-environment node
 *
 * Finding 3 (P1) — PostgreSQL must not be host-published, must not use static/default
 * credentials, and the application must not connect as a superuser.
 *
 * Three layers:
 *  A. the compose files as parsed YAML (topology, credentials, role separation);
 *  B. the REAL compose engine (`docker compose config`), when available, for interpolation
 *     and fail-closed behaviour of required secrets;
 *  C. the bootstrap script's SQL and input validation (mocked pg client).
 *
 * Runtime privilege behaviour against a real PostgreSQL (DML allowed; DDL/CREATE ROLE/COPY PROGRAM
 * denied; rotation; Prisma client as the app role) is verified separately and reported.
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
const composeDev = yaml.load(read('docker-compose.dev.yml'));
const services = compose.services as Record<string, any>;

const envOf = (svc: any): Record<string, string> => {
  const e = svc.environment ?? {};
  return Array.isArray(e)
    ? Object.fromEntries(e.map((x: string) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
    : e;
};

// ═══════════════════════════════════════════════════════════════════════════
// A. Compose topology and credentials
// ═══════════════════════════════════════════════════════════════════════════

describe('A. PostgreSQL is not published to the host', () => {
  it('the postgres service has no `ports` mapping at all', () => {
    expect(services.postgres.ports).toBeUndefined();
    expect(services.postgres.expose === undefined || Array.isArray(services.postgres.expose)).toBe(true);
  });

  it('the only host-published port in the base file is web-ui:3000', () => {
    const published = Object.entries(services)
      .filter(([, s]: any) => s.ports && s.ports.length)
      .map(([n, s]: any) => [n, s.ports]);
    expect(published).toEqual([['web-ui', ['3000:3000']]]);
  });

  it('no service uses host networking or another mechanism that would expose the database', () => {
    for (const [name, s] of Object.entries(services) as [string, any][]) {
      expect(s.network_mode).toBeUndefined();
      expect(s.privileged).not.toBe(true);
      // 5432/5433 must not appear as a host port anywhere in the base file
      expect(JSON.stringify(s.ports ?? [])).not.toMatch(/543[23]/);
      void name;
    }
  });

  it('postgres sits only on the internal `db` network (no route to the outside)', () => {
    expect(services.postgres.networks).toEqual(['db']);
    expect(compose.networks.db.internal).toBe(true);
  });

  it('ai-engine still publishes no port', () => {
    expect(services['ai-engine'].ports).toBeUndefined();
  });

  it('web-ui and ai-engine reach postgres via the db network', () => {
    expect(services['web-ui'].networks).toEqual(expect.arrayContaining(['db', 'default']));
    expect(services['ai-engine'].networks).toEqual(expect.arrayContaining(['db', 'default']));
  });
});

describe('A. developer override is loopback-only and separate', () => {
  it('publishes PostgreSQL only on 127.0.0.1', () => {
    const ports = composeDev.services.postgres.ports as string[];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatch(/^127\.0\.0\.1:/);
    expect(ports.join()).not.toMatch(/(^|,)(0\.0\.0\.0|\[::\]|::):/);
    expect(ports.join()).not.toMatch(/^\d+:\d+/); // an un-prefixed "5433:5432" would bind every interface
  });

  it('the base compose file does not depend on the override', () => {
    expect(JSON.stringify(compose)).not.toContain('docker-compose.dev');
  });

  it('carries no credentials', () => {
    expect(read('docker-compose.dev.yml')).not.toMatch(/PASSWORD\s*[:=]\s*[^\s$]/);
  });
});

describe('A. no static / default credentials', () => {
  const CONFIG_FILES = [
    'docker-compose.yml',
    'docker-compose.dev.yml',
    '.env.example',
    'ai-engine/.env.example',
    'web-ui/.env.example',
    'web-ui/Dockerfile',
    'ai-engine/Dockerfile',
    'web-ui/scripts/db-bootstrap.js',
    'web-ui/scripts/export_and_restore_sessions.js',
    'web-ui/lib/prisma.ts',
    'web-ui/prisma/schema.prisma',
    'ai-engine/app/services/knowledge/repository.py',
  ];

  it.each(CONFIG_FILES)('%s contains neither cad_pass nor a cad_user credential', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/cad_pass/);
    expect(src).not.toMatch(/cad_user/);
  });

  it('README documents the legacy credential only as something to rotate, never as a connection URL', () => {
    const readme = read('README.md');
    expect(readme).not.toMatch(/postgres(ql)?:\/\/cad_user/);
    expect(readme).not.toMatch(/cad_user:cad_pass/);
  });

  it('no tracked config embeds a literal password in a postgres:// URL', () => {
    for (const f of ['docker-compose.yml', 'ai-engine/.env.example', 'web-ui/.env.example', '.env.example']) {
      for (const m of read(f).matchAll(/postgres(?:ql)?:\/\/([^:@\s/]+):([^@\s]*)@/g)) {
        const pw = m[2];
        // allowed: interpolation or an obvious <placeholder>; never a literal secret
        expect(pw).toMatch(/^(\$\{[^}]+\}|<[A-Z_]+>)$/);
      }
    }
  });

  it('every required database secret uses the fail-closed `:?` form in compose', () => {
    const text = read('docker-compose.yml');
    expect(text).toMatch(/POSTGRES_PASSWORD: \$\{POSTGRES_ADMIN_PASSWORD:\?/);
    expect(envOf(services['ai-engine']).DATABASE_URL).toContain('${POSTGRES_APP_PASSWORD:?');
    expect(envOf(services['web-ui']).DATABASE_URL).toContain('${POSTGRES_APP_PASSWORD:?');
    expect(envOf(services.migrate).DATABASE_URL).toContain('${POSTGRES_ADMIN_PASSWORD:?');
    // and none of them supplies a default after `:-`
    expect(text).not.toMatch(/POSTGRES_(ADMIN|APP)_PASSWORD:-/);
  });

  it('the healthcheck does not hard-code a role', () => {
    const test = services.postgres.healthcheck.test.join(' ');
    expect(test).toContain('$$POSTGRES_USER');
    expect(test).not.toMatch(/-U (?!"\$\$)\w+/);
  });

  it('.env.example ships the secrets blank (no usable default password)', () => {
    const env = read('.env.example');
    for (const k of ['POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'SERVICE_API_KEY']) {
      expect(env).toMatch(new RegExp(`^${k}=\\s*$`, 'm'));
    }
  });
});

describe('A. least privilege: the runtime never receives the admin/superuser role', () => {
  const adminVars = /POSTGRES_ADMIN|vexcad_admin/;

  it.each(['web-ui', 'ai-engine'])('%s gets only the application role', (name) => {
    const env = envOf(services[name]);
    expect(JSON.stringify(env)).not.toMatch(adminVars);
    expect(env.DATABASE_URL).toContain('${POSTGRES_APP_USER:-vexcad_app}');
    if (name === 'web-ui') {
      // Prisma CLI-only variable: must also be the app role at runtime
      expect(env.DIRECT_URL).toContain('${POSTGRES_APP_USER:-vexcad_app}');
      expect(env.DIRECT_URL).not.toMatch(adminVars);
    }
  });

  it('only postgres (bootstrap) and migrate (one-shot) reference the admin credential', () => {
    const holders = Object.entries(services)
      .filter(([, s]) => adminVars.test(JSON.stringify(envOf(s))))
      .map(([n]) => n)
      .sort();
    expect(holders).toEqual(['migrate', 'postgres']);
  });

  it('migrate is one-shot, on the db network only, and gates web-ui start', () => {
    expect(services.migrate.restart).toBe('no');
    expect(services.migrate.networks).toEqual(['db']);
    expect(services.migrate.ports).toBeUndefined();
    expect(services['web-ui'].depends_on.migrate.condition).toBe('service_completed_successfully');
    expect(services.migrate.depends_on.postgres.condition).toBe('service_healthy');
  });

  it('the migrate image is a separate Dockerfile stage; the runtime stage stays last and non-root', () => {
    const df = read('web-ui/Dockerfile');
    expect(services.migrate.build.target).toBe('migrate');
    expect(df).toMatch(/FROM deps AS migrate/);
    const stages = [...df.matchAll(/^FROM .* AS (\w+)/gm)].map((m) => m[1]);
    expect(stages[stages.length - 1]).toBe('runner');
    // the migrate stage drops root
    const migrateBlock = df.slice(df.indexOf('FROM deps AS migrate'), df.indexOf('FROM node:20-alpine AS runner'));
    expect(migrateBlock).toMatch(/^USER node$/m);
    // the runtime image must not gain the Prisma CLI / bootstrap script
    const runnerBlock = df.slice(df.indexOf('FROM node:20-alpine AS runner'));
    expect(runnerBlock).not.toMatch(/db-bootstrap|prisma db push/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. The real compose engine (skipped when docker is not installed)
// ═══════════════════════════════════════════════════════════════════════════

const dockerOk = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const describeDocker = dockerOk ? describe : describe.skip;

function renderCompose(extraEnv: Record<string, string>, files = ['docker-compose.yml']) {
  // Empty env + a scratch env-file: neither the caller's shell nor the repo's real .env can leak in.
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
  it('renders with all secrets set: postgres has no published port', () => {
    const r = renderCompose(FULL);
    expect(r.status).toBe(0);
    const cfg = JSON.parse(r.stdout);
    expect(cfg.services.postgres.ports ?? []).toEqual([]);
    expect(cfg.services['ai-engine'].ports ?? []).toEqual([]);
    expect(cfg.networks.db.internal).toBe(true);
  });

  it('web-ui / ai-engine render an application-role URL; migrate renders the admin URL', () => {
    const cfg = JSON.parse(renderCompose(FULL).stdout);
    expect(cfg.services['web-ui'].environment.DATABASE_URL).toMatch(/^postgresql:\/\/vexcad_app:B{24}@postgres:5432\/cad_db$/);
    expect(cfg.services['ai-engine'].environment.DATABASE_URL).toMatch(/^postgresql:\/\/vexcad_app:/);
    expect(cfg.services.migrate.environment.DATABASE_URL).toMatch(/^postgresql:\/\/vexcad_admin:A{24}@postgres:5432\/cad_db$/);
  });

  it.each(['POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'SERVICE_API_KEY', 'JWT_SECRET'])(
    'FAILS CLOSED (non-zero exit, names the variable) when %s is missing',
    (missing) => {
      const env: Record<string, string> = { ...FULL };
      delete env[missing];
      const r = renderCompose(env);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(missing);
    },
  );

  it.each(['POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD'])('FAILS CLOSED when %s is set but empty', (blank) => {
    const r = renderCompose({ ...FULL, [blank]: '' });
    expect(r.status).not.toBe(0);
  });

  it('the dev override publishes postgres on loopback only', () => {
    const r = renderCompose(FULL, ['docker-compose.yml', 'docker-compose.dev.yml']);
    expect(r.status).toBe(0);
    const ports = JSON.parse(r.stdout).services.postgres.ports;
    expect(ports).toHaveLength(1);
    expect(ports[0].host_ip).toBe('127.0.0.1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Bootstrap script: SQL and input validation (mocked pg client)
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bootstrap = require('@/scripts/db-bootstrap.js');

const PW = '0123456789abcdef0123456789';
const ENV = { DATABASE_URL: 'postgresql://vexcad_admin:adminpw@postgres:5432/cad_db', POSTGRES_APP_USER: 'vexcad_app', POSTGRES_APP_PASSWORD: PW };

class FakeClient {
  static instances: FakeClient[] = [];
  queries: { sql: string; params?: unknown[] }[] = [];
  ended = false;
  connected = false;
  constructor(public cfg: any) { FakeClient.instances.push(this); }
  async connect() { this.connected = true; }
  async end() { this.ended = true; }
  escapeIdentifier(s: string) { return `"${s.replace(/"/g, '""')}"`; }
  escapeLiteral(s: string) { return `'${s.replace(/'/g, "''")}'`; }
  static roleManager = true;
  static roleExists = false;
  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (/FROM pg_roles WHERE rolname = current_user/.test(sql)) return { rows: [{ ok: FakeClient.roleManager }] };
    if (/FROM pg_roles WHERE rolname = \$1/.test(sql)) return { rows: FakeClient.roleExists ? [{}] : [] };
    if (/current_database/.test(sql)) return { rows: [{ name: 'cad_db' }] };
    if (/FROM pg_database/.test(sql)) return { rows: [{ datname: 'postgres' }, { datname: 'template1' }] };
    return { rows: [] };
  }
}
const runPhase = (phase: string, env = ENV) => bootstrap.run(phase, env, { Client: FakeClient, log: () => {} });
const last = () => FakeClient.instances[FakeClient.instances.length - 1];
const sqlOf = () => last().queries.map((q) => q.sql);

beforeEach(() => {
  FakeClient.instances = [];
  FakeClient.roleManager = true;
  FakeClient.roleExists = false;
});

describe('C. db-bootstrap `roles` phase', () => {
  it('creates a NON-superuser application role with every dangerous attribute explicitly denied', async () => {
    await runPhase('roles');
    const create = sqlOf().find((s) => s.startsWith('CREATE ROLE'))!;
    expect(create).toContain('"vexcad_app"');
    for (const attr of ['LOGIN', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS']) {
      expect(create).toContain(attr);
    }
    expect(create).not.toMatch(/(?<!NO)SUPERUSER|(?<!NO)CREATEROLE|(?<!NO)CREATEDB/);
  });

  it('is idempotent: an existing role is ALTERed (password rotation), never re-created', async () => {
    FakeClient.roleExists = true;
    await runPhase('roles');
    expect(sqlOf().some((s) => s.startsWith('ALTER ROLE'))).toBe(true);
    expect(sqlOf().some((s) => s.startsWith('CREATE ROLE'))).toBe(false);
  });

  it('confines the role to this database: revokes PUBLIC and maintenance-database CONNECT', async () => {
    await runPhase('roles');
    const s = sqlOf();
    expect(s).toContain('REVOKE ALL ON DATABASE "cad_db" FROM PUBLIC');
    expect(s).toContain('GRANT CONNECT ON DATABASE "cad_db" TO "vexcad_app"');
    expect(s).toContain('REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC');
    expect(s).toContain('REVOKE CONNECT ON DATABASE "template1" FROM PUBLIC');
    expect(s).toContain('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    expect(s).toContain('GRANT USAGE ON SCHEMA public TO "vexcad_app"');
  });

  it('runs in one transaction and rolls back on failure', async () => {
    const boom = class extends FakeClient {
      async query(sql: string, params?: unknown[]) {
        if (sql.startsWith('GRANT CONNECT')) throw new Error('boom');
        return super.query(sql, params);
      }
    };
    await expect(bootstrap.run('roles', ENV, { Client: boom, log: () => {} })).rejects.toThrow('boom');
    const q = FakeClient.instances[FakeClient.instances.length - 1].queries.map((x) => x.sql);
    expect(q).toContain('BEGIN');
    expect(q).toContain('ROLLBACK');
    expect(q).not.toContain('COMMIT');
    expect(FakeClient.instances[FakeClient.instances.length - 1].ended).toBe(true);
  });

  it('always closes the connection', async () => {
    await runPhase('roles');
    expect(last().ended).toBe(true);
  });

  it('escapes hostile characters in the password (no SQL injection through the credential)', async () => {
    await runPhase('roles', { ...ENV, POSTGRES_APP_PASSWORD: "abcdefghijklmnop'; DROP ROLE vexcad_admin; --" });
    const create = sqlOf().find((s) => s.startsWith('CREATE ROLE'))!;
    expect(create).toContain("PASSWORD 'abcdefghijklmnop''; DROP ROLE vexcad_admin; --'");
  });

  it('never logs the password', async () => {
    const logs: string[] = [];
    await bootstrap.run('roles', ENV, { Client: FakeClient, log: (m: string) => logs.push(m) });
    expect(logs.join('\n')).not.toContain(PW);
  });
});

describe('C. db-bootstrap `grants` phase', () => {
  it('grants DML only — no DDL/TRUNCATE/ALL PRIVILEGES to the application role', async () => {
    await runPhase('grants');
    const s = sqlOf().join('\n');
    expect(s).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "vexcad_app"');
    expect(s).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "vexcad_app"');
    expect(s).toContain('REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM "vexcad_app"');
    expect(s).not.toMatch(/GRANT ALL/i);
    expect(s).not.toMatch(/GRANT [^;\n]*(TRUNCATE|REFERENCES|TRIGGER|CREATE)[^;\n]* TO/i);
    expect(s).not.toMatch(/OWNER TO|SUPERUSER/i);
  });
});

describe('C. db-bootstrap fails safely on bad input (before any connection)', () => {
  const bad: [string, Record<string, string | undefined>, RegExp][] = [
    ['missing DATABASE_URL', { ...ENV, DATABASE_URL: undefined }, /DATABASE_URL is required/],
    ['missing app password', { ...ENV, POSTGRES_APP_PASSWORD: undefined }, /POSTGRES_APP_PASSWORD is required/],
    ['blank app password', { ...ENV, POSTGRES_APP_PASSWORD: '   ' }, /POSTGRES_APP_PASSWORD is required/],
    ['short app password', { ...ENV, POSTGRES_APP_PASSWORD: 'short' }, /at least 16/],
    ['app role equal to admin role', { ...ENV, POSTGRES_APP_USER: 'vexcad_admin' }, /must differ/],
    ['SQL in role name', { ...ENV, POSTGRES_APP_USER: 'x"; DROP ROLE a; --' }, /must match/],
    ['uppercase / space in role name', { ...ENV, POSTGRES_APP_USER: 'My App' }, /must match/],
    ['reserved role name', { ...ENV, POSTGRES_APP_USER: 'postgres' }, /reserved/],
    ['pg_ prefixed role name', { ...ENV, POSTGRES_APP_USER: 'pg_monitor' }, /reserved/],
    ['malformed connection URL', { ...ENV, DATABASE_URL: 'not a url' }, /valid connection URL/],
  ];

  it.each(bad)('%s → rejected without connecting', async (_l, env, re) => {
    await expect(bootstrap.run('roles', env as any, { Client: FakeClient, log: () => {} })).rejects.toThrow(re);
    expect(FakeClient.instances).toHaveLength(0);
  });

  it('an unknown phase is rejected', async () => {
    await expect(bootstrap.run('drop-everything', ENV, { Client: FakeClient })).rejects.toThrow(/usage/);
    expect(FakeClient.instances).toHaveLength(0);
  });

  it('refuses to run under a role that cannot manage roles', async () => {
    FakeClient.roleManager = false;
    await expect(runPhase('roles')).rejects.toThrow(/cannot manage roles/);
    expect(sqlOf().some((s) => /CREATE ROLE|ALTER ROLE|GRANT/.test(s))).toBe(false);
    expect(last().ended).toBe(true);
  });

  it('defaults the application role name when POSTGRES_APP_USER is unset', () => {
    expect(bootstrap.readConfig({ ...ENV, POSTGRES_APP_USER: undefined }).appUser).toBe('vexcad_app');
  });
});
