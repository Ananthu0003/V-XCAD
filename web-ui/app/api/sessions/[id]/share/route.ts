import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const shareBodySchema = z.object({
  isShared: z.boolean(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const id = (await params).id;
        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const authUserId = await requireSession();
        if (!authUserId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const session = await prisma.cadSession.findUnique({
            where: { id },
            select: { userId: true, isShared: true }
        });

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        if (session.userId !== authUserId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const parsed = shareBodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid request body. Provide { isShared: boolean }.' },
                { status: 400 }
            );
        }

        const { isShared } = parsed.data;

        await prisma.cadSession.update({
            where: { id },
            data: { isShared }
        });

        return NextResponse.json({ success: true, isShared });
    } catch (error) {
        console.error('Failed to toggle share state:', error);
        return NextResponse.json(
            { error: 'Failed to update share settings' },
            { status: 500 }
        );
    }
}
