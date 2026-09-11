import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
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
  const body = (await req.json().catch(() => null)) ?? {};
  const { reason } = body;

  // Atomic conditional state transition: only succeed if status is still PENDING.
  const { count } = await prisma.passwordResetRequest.updateMany({
    where: {
      id,
      status: 'pending',
    },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: adminId,
      rejectReason: typeof reason === 'string' ? reason : null,
    },
  });

  if (count === 0) {
    const existing = await prisma.passwordResetRequest.findFirst({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { message: 'Request not found.' } },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: { message: 'Request has already been processed.' } },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
