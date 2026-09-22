import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { cookies } from 'next/headers';
import {
  AUTH_INPUT_LIMITS,
  ConcurrencyLimitError,
  RATE_LIMITS,
  accountKey,
  anonHashGuard,
  busyResponse,
  enforce,
  getTrustedClientIp,
  rateLimitedResponse,
} from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      name.length > AUTH_INPUT_LIMITS.nameMaxLength ||
      email.length > AUTH_INPUT_LIMITS.emailMaxLength ||
      password.length > AUTH_INPUT_LIMITS.passwordMaxLength
    ) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Throttle BEFORE the database lookup and the password hash. Per-email always; per-IP only when
    // a trusted proxy supplies a trustworthy address. Without one, flooding with many DISTINCT emails
    // is bounded by the hashing pool below (CPU), not by count — see lib/rateLimit.ts.
    const limited = await enforce([
      [RATE_LIMITS.registerAccount, accountKey(email)],
      [RATE_LIMITS.registerIp, getTrustedClientIp(req.headers)],
    ]);
    if (limited) return rateLimitedResponse(limited);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 });
    }

    // Anonymous hashing has its own small pool so a registration flood cannot starve logins.
    let hashedPassword: string;
    try {
      hashedPassword = await anonHashGuard().run(() => bcrypt.hash(password, 10));
    } catch (err) {
      if (err instanceof ConcurrencyLimitError) return busyResponse();
      throw err;
    }

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    const token = await signToken({ userId: user.id, email: user.email, tokenVersion: 0 });
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
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
