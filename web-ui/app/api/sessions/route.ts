import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const authSession = await getSession();
        const userId = authSession?.userId || null;

        const sessions = await prisma.cadSession.findMany({
            where: {
                OR: [
                    { userId: userId },
                    { userId: null }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            }
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
        const userId = authSession?.userId || null;

        await prisma.cadSession.deleteMany({
            where: {
                OR: [
                    { userId: userId },
                    { userId: null }
                ]
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
