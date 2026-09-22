#!/usr/bin/env node
/**
 * Idempotent PostgreSQL role/grant bootstrap (Finding 3 — least privilege).
 *
 * Runs as the ADMIN/owner role (DATABASE_URL points at it) inside the one-shot `migrate`
 * compose service — never inside web-ui or ai-engine.
 *
 *   node scripts/db-bootstrap.js roles    # before `prisma db push`
 *   node scripts/db-bootstrap.js grants   # after  `prisma db push`
 *
 * What it establishes for the application role (POSTGRES_APP_USER):
 *   - LOGIN, and explicitly NOT superuser / createdb / createrole / replication / bypassrls
 *   - CONNECT on this database only (PUBLIC's default CONNECT/TEMP is revoked, and PUBLIC's CONNECT
 *     on the postgres/template1 maintenance databases is revoked so the role cannot browse them)
 *   - USAGE on schema public; SELECT/INSERT/UPDATE/DELETE on tables (existing AND future ones
 *     created by the admin role); USAGE/SELECT on sequences
 *   - NO DDL (cannot create/alter/drop tables), NO TRUNCATE, NO TRIGGER, NO REFERENCES
 *
 * That is exactly what the application needs: the web-ui and ai-engine issue only DML
 * (verified: no CREATE/ALTER/DROP/TRUNCATE/extension use, and the schema has no sequences).
 * Schema changes stay with the admin role via `prisma db push`.
 *
 * Fails safely: any missing/invalid input aborts with a non-zero exit before touching the
 * database. Passwords are never logged.
 */
'use strict';

/** Lowercase identifier, PostgreSQL-safe, max 63 bytes. */
const ROLE_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const MIN_APP_PASSWORD_LENGTH = 16;
const PRIVILEGED_ROLE_NAMES = new Set(['postgres', 'public', 'none', 'current_user', 'session_user']);

function requireEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function validateRoleName(name, label) {
  if (typeof name !== 'string' || !ROLE_NAME_RE.test(name)) {
    throw new Error(`${label} must match ${ROLE_NAME_RE} (lowercase letters, digits, underscore)`);
  }
  if (name.startsWith('pg_') || PRIVILEGED_ROLE_NAMES.has(name)) {
    throw new Error(`${label} "${name}" is reserved`);
  }
  return name;
}

/** Validate + normalise the inputs. Throws before any database access. */
function readConfig(env) {
  const databaseUrl = requireEnv(env, 'DATABASE_URL');
  const appUser = validateRoleName(env.POSTGRES_APP_USER || 'vexcad_app', 'POSTGRES_APP_USER');
  const appPassword = requireEnv(env, 'POSTGRES_APP_PASSWORD');
  if (appPassword.length < MIN_APP_PASSWORD_LENGTH) {
    throw new Error(`POSTGRES_APP_PASSWORD must be at least ${MIN_APP_PASSWORD_LENGTH} characters`);
  }

  let adminUser;
  try {
    adminUser = decodeURIComponent(new URL(databaseUrl).username);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL');
  }
  if (!adminUser) throw new Error('DATABASE_URL must include the admin user');
  // Never let the bootstrap rewrite/demote the role it is connected as.
  if (adminUser === appUser) {
    throw new Error('POSTGRES_APP_USER must differ from the admin role used to run the bootstrap');
  }
  return { databaseUrl, appUser, appPassword, adminUser };
}

const ROLE_ATTRIBUTES = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

/** SQL for the `roles` phase. `q` = { ident, literal } escapers from the live connection. */
function buildRoleStatements({ appUser, appPassword, roleExists, dbName, otherDatabases = [] }, q) {
  const role = q.ident(appUser);
  const db = q.ident(dbName);
  return [
    roleExists
      ? `ALTER ROLE ${role} WITH ${ROLE_ATTRIBUTES} PASSWORD ${q.literal(appPassword)}`
      : `CREATE ROLE ${role} WITH ${ROLE_ATTRIBUTES} PASSWORD ${q.literal(appPassword)}`,
    `REVOKE ALL ON DATABASE ${db} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${db} TO ${role}`,
    // PUBLIC may CONNECT to every database by default, which would let the application role open
    // the maintenance databases and read cluster catalogs. Close that for the ones that exist.
    ...otherDatabases.map((name) => `REVOKE CONNECT ON DATABASE ${q.ident(name)} FROM PUBLIC`),
    `REVOKE ALL ON SCHEMA public FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
  ];
}

/** Maintenance databases whose default PUBLIC CONNECT privilege is revoked (when present). */
const MAINTENANCE_DATABASES = ['postgres', 'template1'];

/** SQL for the `grants` phase (run after the schema exists). */
function buildGrantStatements({ appUser }, q) {
  const role = q.ident(appUser);
  return [
    // Make the grant set exact and repeatable: drop anything beyond DML first.
    `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    // Tables/sequences the admin role creates LATER (future `prisma db push`) get the same DML-only grant.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  ];
}

/**
 * @param {'roles'|'grants'} phase
 * @param {NodeJS.ProcessEnv} env
 * @param {{ Client: new (cfg: object) => any, log?: (m: string) => void }} deps
 */
async function run(phase, env, deps = {}) {
  const log = deps.log || ((m) => console.log(m));
  if (phase !== 'roles' && phase !== 'grants') {
    throw new Error('usage: db-bootstrap.js <roles|grants>');
  }
  const cfg = readConfig(env); // validates everything BEFORE connecting
  const Client = deps.Client || require('pg').Client;

  const client = new Client({ connectionString: cfg.databaseUrl });
  await client.connect();
  try {
    const q = {
      ident: (s) => client.escapeIdentifier(s),
      literal: (s) => client.escapeLiteral(s),
    };

    // The bootstrap must run as a role that can manage roles; refuse to run half-privileged.
    const me = await client.query('SELECT rolsuper OR rolcreaterole AS ok FROM pg_roles WHERE rolname = current_user');
    if (!me.rows[0] || !me.rows[0].ok) {
      throw new Error('the connecting role cannot manage roles; run this with the admin/owner role');
    }

    let statements;
    if (phase === 'roles') {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [cfg.appUser]);
      const db = await client.query('SELECT current_database() AS name');
      const dbName = db.rows[0].name;
      const present = await client.query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [MAINTENANCE_DATABASES]);
      const otherDatabases = present.rows.map((r) => r.datname).filter((n) => n !== dbName);
      statements = buildRoleStatements(
        { appUser: cfg.appUser, appPassword: cfg.appPassword, roleExists: exists.rows.length > 0, dbName, otherDatabases },
        q,
      );
    } else {
      statements = buildGrantStatements({ appUser: cfg.appUser }, q);
    }

    await client.query('BEGIN');
    try {
      for (const sql of statements) await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    log(`db-bootstrap: ${phase} applied for application role "${cfg.appUser}" (${statements.length} statements)`);
  } finally {
    await client.end();
  }
}

module.exports = {
  ROLE_NAME_RE,
  MIN_APP_PASSWORD_LENGTH,
  MAINTENANCE_DATABASES,
  validateRoleName,
  readConfig,
  buildRoleStatements,
  buildGrantStatements,
  run,
};

if (require.main === module) {
  run(process.argv[2], process.env).catch((err) => {
    // Print the reason only (never the environment or credentials).
    console.error(`db-bootstrap: FAILED — ${err.message}`);
    process.exit(1);
  });
}
