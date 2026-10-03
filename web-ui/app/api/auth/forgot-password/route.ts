import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
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

const TOKEN_EXPIRY_HOURS = 24;

export async function POST(req: NextRequest) {
  try {
    const { email, newPassword, confirmPassword } = await req.json();

    if (!email || !newPassword) {
      return NextResponse.json({ error: 'Missing email or new password' }, { status: 400 });
    }
    if (
      typeof email !== 'string' ||
      typeof newPassword !== 'string' ||
      (confirmPassword !== undefined && typeof confirmPassword !== 'string') ||
      email.length > AUTH_INPUT_LIMITS.emailMaxLength ||
      newPassword.length > AUTH_INPUT_LIMITS.passwordMaxLength
    ) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long' }, { status: 400 });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Throttle BEFORE any database access or hashing. The limit is applied to EVERY email identically
    // (whether or not an account exists) so a 429 reveals nothing about account existence.
    const limited = await enforce([
      [RATE_LIMITS.forgotAccount, accountKey(normalizedEmail)],
      [RATE_LIMITS.forgotIp, getTrustedClientIp(req.headers)],
    ]);
    if (limited) return rateLimitedResponse(limited);

    // VEX-2A-011: Always return the same response to prevent account enumeration.
    const successResponse = NextResponse.json({
      success: true,
      message: 'If an account with that email exists, a password reset request has been submitted for administrator approval.',
    });

    // Hash BEFORE looking the account up, for every request, so existing and non-existing emails
    // cost the same (previously only existing accounts paid for a hash: a timing oracle).
    let hashedPassword: string;
    try {
      hashedPassword = await anonHashGuard().run(() => bcrypt.hash(newPassword, 10));
    } catch (err) {
      if (err instanceof ConcurrencyLimitError) return busyResponse();
      throw err;
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      // Return same success response — do not reveal whether the email exists.
      return successResponse;
    }

    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Check for an existing pending request for this user.
    const existingPending = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: 'pending' },
    });

    if (existingPending) {
      // Replace the existing pending request with the new password hash.
      await prisma.passwordResetRequest.update({
        where: { id: existingPending.id },
        data: {
          passwordHash: hashedPassword,
          expiresAt,
          createdAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          rejectReason: null,
        },
      });
    } else {
      await prisma.passwordResetRequest.create({
        data: {
          userId: user.id,
          passwordHash: hashedPassword,
          expiresAt,
        },
      });
    }

    return successResponse;
  } catch (error) {
    console.error('Password reset request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
