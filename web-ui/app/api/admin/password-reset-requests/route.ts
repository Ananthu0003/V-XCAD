import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json(
      { error: { message: 'Forbidden. Administrator access required.' } },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'pending';

  const requests = await prisma.passwordResetRequest.findMany({
    where: {
      status,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      rejectReason: true,
      user: {
        select: { email: true, name: true },
      },
    },
  });

  return NextResponse.json({ requests });
}
