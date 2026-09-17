import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json(
      { error: { message: 'Forbidden. Administrator access required.' } },
      { status: 403 }
    );
  }

  const { id } = await params;

  // Use a transaction to atomically approve and update the password.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Atomic conditional state transition: only succeed if status is still PENDING.
      const { count } = await tx.passwordResetRequest.updateMany({
        where: {
          id,
          status: 'pending',
        },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedBy: adminId,
        },
      });

      if (count === 0) {
        // Determine whether the request exists or was already processed.
        const existing = await tx.passwordResetRequest.findFirst({
          where: { id },
          select: { status: true },
        });
        if (!existing) {
          return { status: 'not_found' as const };
        }
        return { status: 'already_processed' as const };
      }

      // Fetch the request to get userId and passwordHash for the user update.
      const request = await tx.passwordResetRequest.findUnique({
        where: { id },
        select: { userId: true, passwordHash: true },
      });

      if (!request) {
        // Should not happen — the updateMany just succeeded on this row.
        return { status: 'not_found' as const };
      }

      // Update the user's password and invalidate all existing tokens.
      await tx.user.update({
        where: { id: request.userId },
        data: {
          password: request.passwordHash,
          tokenVersion: { increment: 1 },
        },
      });

      return { status: 'approved' as const };
    });

    if (result.status === 'not_found') {
      return NextResponse.json(
        { error: { message: 'Request not found.' } },
        { status: 404 }
      );
    }

    if (result.status === 'already_processed') {
      return NextResponse.json(
        { error: { message: 'Request has already been processed.' } },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Password reset approval error:', error);
    return NextResponse.json(
      { error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
