import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const sessions = await prisma.cadSession.findMany({
            where: {
                pythonScript: { not: null },
                stlUrl: { not: null }
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
        await prisma.cadSession.deleteMany({});
        return NextResponse.json({ message: 'History cleared' });
    } catch (error) {
        console.error('Failed to clear sessions:', error);
        return NextResponse.json(
            { error: 'Failed to clear history' },
            { status: 500 }
        );
    }
}
