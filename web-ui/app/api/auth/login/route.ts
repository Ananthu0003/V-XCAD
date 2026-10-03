import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { cookies } from 'next/headers';
import {
  AUTH_INPUT_LIMITS,
  CONCURRENCY,
  ConcurrencyLimitError,
  RATE_LIMITS,
  accountKey,
  busyResponse,
  checkLoginBackoff,
  enforce,
  getTrustedClientIp,
  loginHashGuard,
  rateLimitedResponse,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/lib/rateLimit';

// A real bcrypt (cost 10) hash of a random value nobody knows. Unknown emails are compared against
// it so "no such user" costs about the same as "wrong password" (timing-based account enumeration).
// It is not a credential: the plaintext was random and discarded.
const DUMMY_PASSWORD_HASH = '$2b$10$.C62kjMUFSIA8UOPbg1s8eLCGFX.I.roWOg4QI3Y4JVoqmjBqGSGW';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.length > AUTH_INPUT_LIMITS.emailMaxLength ||
      password.length > AUTH_INPUT_LIMITS.passwordMaxLength
    ) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const lookup = email.trim().toLowerCase();
    // Canonical account identity: the `admin` alias and its real address are ONE account, so they
    // must share one attempt counter (otherwise alternating them doubles the guesses).
    const canonicalEmail = lookup === 'admin' ? 'admin@vexcad.local' : lookup;
    const acctKey = accountKey(canonicalEmail);

    // R1: per-account CAPPED backoff — never a full-window lockout, see LOGIN_BACKOFF for why.
    // Checked BEFORE any database lookup or password hashing.
    const backoff = await checkLoginBackoff(acctKey);
    if (!backoff.allowed) return rateLimitedResponse(backoff);

    // Per-IP applies only when a trusted proxy supplies a trustworthy address
    // (X-Forwarded-For is never trusted on its own — see the file header in lib/rateLimit.ts).
    const ipLimited = await enforce([[RATE_LIMITS.loginIp, getTrustedClientIp(req.headers)]]);
    if (ipLimited) return rateLimitedResponse(ipLimited);

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: lookup },
          { email: lookup === 'admin' ? 'admin@vexcad.local' : lookup },
        ],
      },
    });

    let isPasswordValid = false;
    try {
      if (user) {
        isPasswordValid = await loginHashGuard().run(() => bcrypt.compare(password, user.password));
      } else {
        // Best effort only: skipped when the pool is busy, so random-email floods can never queue
        // ahead of (or starve) real logins. Degrades timing equalisation, never availability.
        await loginHashGuard().runIfIdle(() => bcrypt.compare(password, DUMMY_PASSWORD_HASH), CONCURRENCY.dummyHashReserve);
      }
    } catch (err) {
      if (err instanceof ConcurrencyLimitError) return busyResponse();
      throw err;
    }

    if (!user || !isPasswordValid) {
      await recordLoginFailure(acctKey);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Successful authentication clears this account's backoff state.
    await recordLoginSuccess(acctKey);

    const token = await signToken({ userId: user.id, email: user.email, tokenVersion: user.tokenVersion });
    const cookieStore = await cookies();
    cookieStore.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    });

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
