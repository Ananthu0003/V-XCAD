import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: any) {
	try {
		const { id } = await context.params;
		const authSession = await getSession();
		const userId = authSession?.userId || null;

		const session = await prisma.cadSession.findUnique({
			where: { id },
			select: {
				id: true,
				userId: true,
				isShared: true,
			},
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		if (session.userId !== userId && !session.isShared && session.userId !== null) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}

		let iterations: any[] = [];
		if ((prisma as any).cadIteration) {
			iterations = await (prisma as any).cadIteration.findMany({
				where: { sessionId: id },
				orderBy: { version: 'asc' },
			});
		} else {
			iterations = await prisma.$queryRawUnsafe<any[]>(
				`SELECT "id", "sessionId", "version", "prompt", "source", "pythonScript", "parameters", "featureMap", "annotations", "stlUrl", "stepUrl", "dxfUrl", "createdAt" 
				 FROM "CadIteration" 
				 WHERE "sessionId" = $1 
				 ORDER BY "version" ASC`,
				id
			).catch(() => []);
		}

		const currentVersion = iterations.length > 0 ? iterations[iterations.length - 1].version : 1;

		return NextResponse.json({
			sessionId: id,
			currentVersion,
			iterations,
		});
	} catch (error) {
		console.error('Failed to fetch session iterations:', error);
		return NextResponse.json({ error: 'Failed to fetch iterations' }, { status: 500 });
	}
}
