import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const authSession = await getSession();
        if (!authSession?.userId) {
            return NextResponse.json([], { status: 200 });
        }

        const sessions = await prisma.cadSession.findMany({
            where: {
                userId: authSession.userId,
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 20 // Limit to last 20 sessions for now
        });

        return NextResponse.json(sessions);
    } catch (error) {
        console.error('Failed to fetch sessions:', error);
        return NextResponse.json(
            { error: 'Failed to fetch history' },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    try {
        const authSession = await getSession();
        if (!authSession?.userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await prisma.cadSession.deleteMany({
            where: {
                userId: authSession.userId
            }
        });
        return NextResponse.json({ message: 'History cleared' });
    } catch (error) {
        console.error('Failed to clear sessions:', error);
        return NextResponse.json(
            { error: 'Failed to clear history' },
            { status: 500 }
        );
    }
}
