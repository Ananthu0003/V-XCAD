import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await requireSession();
  if (!userId) {
    return NextResponse.json(
      { error: { message: 'Authentication required.' } },
      { status: 401 }
    );
  }

  const request = await prisma.passwordResetRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      rejectReason: true,
      expiresAt: true,
    },
  });

  return NextResponse.json({ request });
}
