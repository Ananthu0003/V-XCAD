/**
 * Abuse controls for the BFF (Finding 4): bounded attempt counters + bounded concurrency.
 *
 * ── What identity can be trusted? ────────────────────────────────────────────────────────
 * web-ui is published directly (no reverse proxy), and Next.js only fills `X-Forwarded-For`
 * with the socket address when the client did NOT send one (`req.headers['x-forwarded-for'] ??=`).
 * A client-supplied `X-Forwarded-For` therefore survives verbatim, so it is ATTACKER-CONTROLLED
 * and is never used as an identity here unless the operator explicitly declares a trusted proxy
 * (TRUST_PROXY_HEADERS=true) that is the only path to this service. Until then the trustworthy
 * identities are:
 *   - the normalised target account/email          (pre-auth endpoints)
 *   - the authenticated user id                    (post-auth endpoints)
 *   - process-local concurrency caps               (hash / render work)
 * The consequence is stated plainly: with no trusted proxy there is NO per-source-IP limit.
 * Registration and forgot-password flooding by many distinct emails is therefore bounded only by
 * the concurrency pools below (CPU), not by count. A trusted reverse proxy or email verification
 * closes that; see README "Rate limiting".
 *
 * ── Storage ──────────────────────────────────────────────────────────────────────────────
 * Attempt counters live in PostgreSQL (`RateLimitBucket`) and are updated with a single atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` (one round trip, no read-modify-write race, correct
 * across restarts and multiple web-ui instances). If the store is unavailable the limiter falls
 * back to a bounded in-process fixed-window counter — it never turns into "allow everything",
 * and it never touches authentication (credential checks always still run).
 */
import { createHash } from 'crypto';
import { isIP } from 'net';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ═══════════════════════════════════════════════════════════════════════════
// Configuration — every limit and window lives here (no magic numbers in routes)
// ═══════════════════════════════════════════════════════════════════════════

export type RateLimitRule = { readonly name: string; readonly limit: number; readonly windowSec: number };

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  // Per account. Registration attempts / password-reset requests per email address.
  registerAccount: { name: 'register:acct', limit: 3, windowSec: HOUR },
  forgotAccount: { name: 'forgot:acct', limit: 3, windowSec: HOUR },
  // Per source IP — ONLY applied when a trusted proxy supplies a trustworthy address.
  loginIp: { name: 'login:ip', limit: 60, windowSec: 15 * MINUTE },
  registerIp: { name: 'register:ip', limit: 10, windowSec: HOUR },
  forgotIp: { name: 'forgot:ip', limit: 10, windowSec: HOUR },
  // Per authenticated admin (password-reset review endpoints).
  adminAction: { name: 'admin:user', limit: 60, windowSec: MINUTE },
  // Per authenticated user on the expensive (CPU / LLM-cost) endpoints.
  render: { name: 'render:user', limit: 30, windowSec: MINUTE },
  generate: { name: 'generate:user', limit: 10, windowSec: MINUTE },
  assistant: { name: 'assistant:user', limit: 20, windowSec: MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/**
 * R1 — login per-account policy: a CAPPED, exponentially-increasing delay, not a flat
 * fixed-window block.
 *
 * The naive "N attempts per window, then hard-blocked for the rest of the window" policy has a
 * serious flaw given no trusted per-IP identity is available (see the file header): an anonymous
 * caller who knows only a target's EMAIL — e.g. the well-known `admin` alias — can trip the block
 * with a handful of wrong guesses and then deny the legitimate account holder, including the
 * password-reset administrator, for the ENTIRE window (previously 15 minutes). That is a
 * denial-of-service on the account, not a defense of it.
 *
 * Instead: the first `freeAttempts` failures cost nothing (normal typo tolerance). Each failure
 * after that raises the delay before the NEXT attempt is even looked at, geometrically
 * (`baseDelaySec * multiplier^n`), but the delay is hard-capped at `maxDelaySec`. Consequences:
 *   - No sequence of anonymous requests — however long or persistent — can ever deny the
 *     correct-credential holder for more than `maxDelaySec` at a stretch (60s here, not 900s).
 *   - Credential stuffing is still meaningfully throttled: once the cap is reached, a sustained
 *     attacker is limited to roughly one guess every `maxDelaySec` (≈1,440/day), down from
 *     effectively unlimited.
 *   - The policy applies per ACCOUNT, identically for every account — there is no admin-specific
 *     carve-out, so an ordinary account gets exactly the same protection.
 * A quiet period of `resetAfterSec` with no failures clears the failure count back to zero.
 */
export const LOGIN_BACKOFF = {
  name: 'login:acct:backoff',
  freeAttempts: 3,
  baseDelaySec: 2,
  multiplier: 4,
  maxDelaySec: 60,
  resetAfterSec: 15 * MINUTE,
} as const;

/** Bounds on concurrent expensive work (a concurrency cap, NOT a shared attempt bucket). */
export const CONCURRENCY = {
  // bcrypt compare for real logins.
  loginHash: { max: 4, maxQueue: 16 },
  // bcrypt hash for the anonymous register / forgot-password flows. Deliberately a SEPARATE pool so a
  // flood of throw-away registrations can never starve logins.
  // R2: bcryptjs cost-10 compare/hash measured ≈56ms on reference hardware. max=4 lets a small burst
  // of simultaneous legitimate signups (a shared link, a launch) run without queuing at all; maxQueue=12
  // gives 16 total capacity before any 503, at a worst-case ~12×56ms≈0.7s added latency for the last
  // queued request — noticeable, not a failure. Beyond that, load is shed (503) rather than queued
  // without bound, which is what actually protects CPU/memory under a sustained flood.
  anonHash: { max: 4, maxQueue: 12 },
  // Slots kept free for real accounts: dummy (timing-equalising) hashes for unknown emails only run
  // when at least this many slots are idle, so a flood of random emails can never queue ahead of a real user.
  dummyHashReserve: 1,
  // R3: per-user cap deliberately kept a small MINORITY of the global cap. Registration is open and
  // free, so the only lever against a handful of throwaway accounts consuming the ENTIRE renderer is
  // keeping renderPerUser small relative to renderGlobal. At 1:8, four throwaway accounts occupy at
  // most 4 of 8 slots (50%), always leaving capacity for real users, and fully exhausting the pool
  // now needs 8 distinct accounts instead of 4. (Previously 2:8 meant exactly 4 accounts sufficed.)
  renderPerUser: 1,
  renderGlobal: 8,
} as const;

/** bcrypt only uses the first 72 bytes; reject absurd inputs before spending CPU/memory on them. */
export const AUTH_INPUT_LIMITS = { passwordMaxLength: 1024, emailMaxLength: 254, nameMaxLength: 200 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Identity helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Case/whitespace-insensitive, fixed-length, non-reversible key for an email address. */
export function accountKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Client IP, ONLY if the operator declared a trusted proxy (TRUST_PROXY_HEADERS=true).
 * Uses the RIGHT-most X-Forwarded-For entry — the one appended by our own proxy — never the
 * left-most, which the client controls. Returns null otherwise (callers then skip IP limits).
 */
export function getTrustedClientIp(headers: Headers): string | null {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return null;
  const xff = headers.get('x-forwarded-for');
  if (!xff) return null;
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  const candidate = parts[parts.length - 1];
  return candidate && isIP(candidate) ? candidate : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Attempt counters
// ═══════════════════════════════════════════════════════════════════════════

export type RateLimitResult = { allowed: boolean; count: number; limit: number; retryAfterSec: number };

type MemBucket = { count: number; windowStart: number };
const MEM_MAX_KEYS = 10_000;
const g = globalThis as unknown as { __vexRateLimitMem?: Map<string, MemBucket>; __vexRateLimitWarned?: boolean };
function memStore(): Map<string, MemBucket> {
  return (g.__vexRateLimitMem ??= new Map());
}

/** Log the store-unavailable fallback exactly once (shared by every consumer of the store). */
function warnStoreUnavailable(err: unknown): void {
  if (g.__vexRateLimitWarned) return;
  g.__vexRateLimitWarned = true;
  console.error('[rate-limit] store unavailable, using bounded in-process counters:', (err as Error)?.message);
}

function consumeInMemory(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const store = memStore();
  const windowMs = rule.windowSec * 1000;
  let b = store.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    if (!b && store.size >= MEM_MAX_KEYS) {
      for (const [k, v] of store) if (now - v.windowStart >= windowMs) store.delete(k);
      // still full: drop the oldest entry so memory stays bounded
      if (store.size >= MEM_MAX_KEYS) store.delete(store.keys().next().value as string);
    }
    b = { count: 0, windowStart: now };
  }
  b.count += 1;
  store.set(key, b);
  const retryAfterSec = Math.max(0, Math.ceil((b.windowStart + windowMs - now) / 1000));
  return { allowed: b.count <= rule.limit, count: b.count, limit: rule.limit, retryAfterSec };
}

/**
 * Count one attempt against `rule` for `identity` and report whether it is within the limit.
 * Atomic in PostgreSQL; falls back to a bounded in-process counter if the store is unavailable.
 */
export async function consume(rule: RateLimitRule, identity: string): Promise<RateLimitResult> {
  const key = `${rule.name}:${identity}`;
  try {
    const rows = await prisma.$queryRaw<{ count: number; retryAfter: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" <= NOW() - make_interval(secs => ${rule.windowSec}::double precision)
                       THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= NOW() - make_interval(secs => ${rule.windowSec}::double precision)
                             THEN NOW() ELSE "RateLimitBucket"."windowStart" END
      RETURNING "count",
        GREATEST(0, EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${rule.windowSec}::double precision) - NOW())))::float8 AS "retryAfter"`;
    const row = rows?.[0];
    if (!row || typeof row.count !== 'number') throw new Error('unexpected rate-limit store response');
    maybePurgeExpired();
    return { allowed: row.count <= rule.limit, count: row.count, limit: rule.limit, retryAfterSec: Math.ceil(row.retryAfter) };
  } catch (err) {
    warnStoreUnavailable(err);
    return consumeInMemory(key, rule);
  }
}

/** Forget an identity's counter (e.g. after a successful login). Best effort. */
export async function reset(rule: { name: string }, identity: string): Promise<void> {
  const key = `${rule.name}:${identity}`;
  memStore().delete(key);
  try {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`;
  } catch {
    /* counter simply expires with its window */
  }
}

/** ~1 in 200 calls: drop long-expired buckets so the table cannot grow without bound. */
function maybePurgeExpired(): void {
  if (Math.random() >= 0.005) return;
  prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "windowStart" < NOW() - INTERVAL '1 day'`.catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// Login backoff (R1) — capped exponential delay; policy documented at LOGIN_BACKOFF above.
// Reuses the same RateLimitBucket table as the fixed-window rules above (no schema change),
// under its own key prefix, but with different semantics: "windowStart" holds the timestamp of
// the LAST failure and "count" holds the number of CONSECUTIVE failures since the last reset,
// rather than "attempts within the current fixed window".
// ═══════════════════════════════════════════════════════════════════════════

export type LoginBackoffResult = { allowed: boolean; retryAfterSec: number };

/** The delay before the NEXT attempt is allowed, given `failureCount` consecutive failures so far. */
export function backoffDelaySec(failureCount: number): number {
  const b = LOGIN_BACKOFF;
  if (failureCount <= b.freeAttempts) return 0;
  const n = failureCount - b.freeAttempts;
  return Math.min(b.baseDelaySec * Math.pow(b.multiplier, n - 1), b.maxDelaySec);
}

type BackoffState = { failureCount: number; lastFailureAt: number };
const backoffMem = globalThis as unknown as { __vexLoginBackoffMem?: Map<string, BackoffState> };
function backoffMemStore(): Map<string, BackoffState> {
  return (backoffMem.__vexLoginBackoffMem ??= new Map());
}

function evaluateBackoff(state: BackoffState | undefined, now: number): LoginBackoffResult {
  if (!state || now - state.lastFailureAt >= LOGIN_BACKOFF.resetAfterSec * 1000) {
    return { allowed: true, retryAfterSec: 0 };
  }
  const nextAllowedAt = state.lastFailureAt + backoffDelaySec(state.failureCount) * 1000;
  if (now >= nextAllowedAt) return { allowed: true, retryAfterSec: 0 };
  return { allowed: false, retryAfterSec: Math.ceil((nextAllowedAt - now) / 1000) };
}

/**
 * Read-only: is this account currently within its backoff delay? Never writes and is not itself
 * counted as an attempt — call this BEFORE any database lookup or password hashing.
 */
export async function checkLoginBackoff(identity: string): Promise<LoginBackoffResult> {
  const key = `${LOGIN_BACKOFF.name}:${identity}`;
  const now = Date.now();
  try {
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      SELECT "count", "windowStart" FROM "RateLimitBucket" WHERE "key" = ${key}`;
    const row = rows?.[0];
    if (!row) return { allowed: true, retryAfterSec: 0 };
    return evaluateBackoff({ failureCount: row.count, lastFailureAt: new Date(row.windowStart).getTime() }, now);
  } catch (err) {
    warnStoreUnavailable(err);
    return evaluateBackoff(backoffMemStore().get(key), now);
  }
}

/** Record a failed attempt: atomically increments the consecutive-failure count. */
export async function recordLoginFailure(identity: string): Promise<void> {
  const key = `${LOGIN_BACKOFF.name}:${identity}`;
  try {
    await prisma.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" <= NOW() - make_interval(secs => ${LOGIN_BACKOFF.resetAfterSec}::double precision)
                       THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = NOW()`;
  } catch (err) {
    warnStoreUnavailable(err);
    const store = backoffMemStore();
    const now = Date.now();
    const prev = store.get(key);
    const stale = prev && now - prev.lastFailureAt >= LOGIN_BACKOFF.resetAfterSec * 1000;
    if (!prev && store.size >= MEM_MAX_KEYS) {
      for (const [k, v] of store) {
        if (now - v.lastFailureAt >= LOGIN_BACKOFF.resetAfterSec * 1000) store.delete(k);
      }
      // still full: drop the oldest entry so memory stays bounded
      if (store.size >= MEM_MAX_KEYS) store.delete(store.keys().next().value as string);
    }
    store.set(key, { failureCount: !prev || stale ? 1 : prev.failureCount + 1, lastFailureAt: now });
  }
}

/** Record a successful attempt: clears the account's backoff state entirely. */
export async function recordLoginSuccess(identity: string): Promise<void> {
  const key = `${LOGIN_BACKOFF.name}:${identity}`;
  backoffMemStore().delete(key);
  try {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`;
  } catch {
    /* best effort — the row is treated as reset once resetAfterSec elapses regardless */
  }
}

/** Consume every (rule, identity) pair; return the first DENIED result (or null if all allowed). */
export async function enforce(checks: Array<[RateLimitRule, string | null | undefined]>): Promise<RateLimitResult | null> {
  let denied: RateLimitResult | null = null;
  for (const [rule, identity] of checks) {
    if (!identity) continue; // e.g. no trusted IP available: skip, never invent an identity
    const r = await consume(rule, identity);
    if (!r.allowed && (!denied || r.retryAfterSec > denied.retryAfterSec)) denied = r;
  }
  return denied;
}

export type ErrorShape = 'flat' | 'nested';
const errorBody = (message: string, shape: ErrorShape) => (shape === 'nested' ? { error: { message } } : { error: message });

/** Uniform 429. Deliberately generic: never reveals which identity/limit tripped. */
export function rateLimitedResponse(result: Pick<RateLimitResult, 'retryAfterSec'>, shape: ErrorShape = 'flat'): NextResponse {
  const retry = Math.max(1, result.retryAfterSec);
  return NextResponse.json(errorBody('Too many requests. Please try again later.', shape), {
    status: 429,
    headers: { 'Retry-After': String(retry) },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency guards
// ═══════════════════════════════════════════════════════════════════════════

export class ConcurrencyLimitError extends Error {
  constructor() {
    super('Server busy');
    this.name = 'ConcurrencyLimitError';
  }
}

/** At most `max` tasks run at once; up to `maxQueue` wait; anything beyond is rejected immediately. */
export class ConcurrencyGuard {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly max: number, private readonly maxQueue: number) {}

  get inFlight(): number { return this.active; }
  get queued(): number { return this.waiters.length; }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiters.length >= this.maxQueue) throw new ConcurrencyLimitError();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next(); // hand the slot straight to the next waiter
      else this.active -= 1;
    }
  }

  /**
   * Run only if at least `reserve` slots would stay free; otherwise skip (returns `undefined`).
   * For best-effort work (timing-equalising dummy hashes) that must never delay real users.
   */
  async runIfIdle<T>(fn: () => Promise<T>, reserve: number): Promise<T | undefined> {
    if (this.active >= this.max - reserve || this.waiters.length > 0) return undefined;
    return this.run(fn);
  }
}

const guards = globalThis as unknown as {
  __vexLoginHashGuard?: ConcurrencyGuard;
  __vexAnonHashGuard?: ConcurrencyGuard;
};
export function loginHashGuard(): ConcurrencyGuard {
  return (guards.__vexLoginHashGuard ??= new ConcurrencyGuard(CONCURRENCY.loginHash.max, CONCURRENCY.loginHash.maxQueue));
}
export function anonHashGuard(): ConcurrencyGuard {
  return (guards.__vexAnonHashGuard ??= new ConcurrencyGuard(CONCURRENCY.anonHash.max, CONCURRENCY.anonHash.maxQueue));
}

export function busyResponse(shape: ErrorShape = 'flat'): NextResponse {
  return NextResponse.json(errorBody('Server is busy. Please try again shortly.', shape), {
    status: 503,
    headers: { 'Retry-After': '5' },
  });
}

/** Non-queuing per-key + global concurrency cap (used for renders). `null` = at capacity. */
export class KeyedSlots {
  private perKey = new Map<string, number>();
  private total = 0;
  constructor(private readonly maxPerKey: number, private readonly maxTotal: number) {}

  acquire(key: string): (() => void) | null {
    const n = this.perKey.get(key) ?? 0;
    if (n >= this.maxPerKey || this.total >= this.maxTotal) return null;
    this.perKey.set(key, n + 1);
    this.total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const cur = (this.perKey.get(key) ?? 1) - 1;
      if (cur <= 0) this.perKey.delete(key); else this.perKey.set(key, cur);
      this.total -= 1;
    };
  }
}

const slots = globalThis as unknown as { __vexRenderSlots?: KeyedSlots };
export function renderSlots(): KeyedSlots {
  return (slots.__vexRenderSlots ??= new KeyedSlots(CONCURRENCY.renderPerUser, CONCURRENCY.renderGlobal));
}
