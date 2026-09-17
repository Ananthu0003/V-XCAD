import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const userId = await requireSession();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // VEX-009: Return only the authenticated user's sessions and intentionally
        // shared sessions.  Null-user (unowned) sessions are excluded.
        const sessions = await prisma.cadSession.findMany({
            where: {
                OR: [
                    { userId },
                    { isShared: true }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const sessionIds = sessions.map(s => s.id);
        let iterationCounts: any[] = [];
        if ((prisma as any).cadIteration) {
            iterationCounts = await (prisma as any).cadIteration.groupBy({
                by: ['sessionId'],
                where: {
                    sessionId: { in: sessionIds }
                },
                _count: {
                    id: true
                }
            }).catch(() => []);
        } else if (sessionIds.length > 0) {
            const rows = await prisma.$queryRawUnsafe<any[]>(
                `SELECT "sessionId", COUNT("id")::int as count FROM "CadIteration" WHERE "sessionId" = ANY($1) GROUP BY "sessionId"`,
                sessionIds
            ).catch(() => []);
            iterationCounts = rows.map((r: any) => ({ sessionId: r.sessionId, _count: { id: r.count } }));
        }

        const countMap = new Map<string, number>();
        iterationCounts.forEach((c: any) => {
            countMap.set(c.sessionId, c._count?.id || 0);
        });

        const formatted = sessions.map(s => ({
            ...s,
            _count: {
                iterations: countMap.get(s.id) || 0
            }
        }));

        return NextResponse.json(formatted);
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
        const userId = await requireSession();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // VEX-2A-005: Only delete sessions owned by the authenticated user.
        await prisma.cadSession.deleteMany({
            where: {
                userId
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
