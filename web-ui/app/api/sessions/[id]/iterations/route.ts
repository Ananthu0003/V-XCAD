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

export async function DELETE(request: Request, context: any) {
	try {
		const { id } = await context.params;
		const authSession = await getSession();
		if (!authSession?.userId) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}
		const { searchParams } = new URL(request.url);
		const iterationId = searchParams.get('iterationId');
		const version = searchParams.get('version');
		const versionNum = version ? parseInt(version, 10) : undefined;

		const session = await prisma.cadSession.findUnique({
			where: { id },
			select: {
				id: true,
				userId: true,
			},
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		// VEX-2A-005: Only the owner may delete iterations from their session.
		// Null-user sessions and shared sessions do not grant deletion rights.
		if (session.userId !== authSession.userId) {
			return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
		}

		// 1. Delete matching CadIteration record by either ID or Version
		const deleteConditions: any[] = [];
		if (iterationId) {
			deleteConditions.push({ id: iterationId });
		}
		if (versionNum && !isNaN(versionNum)) {
			deleteConditions.push({ version: versionNum });
		}

		if (deleteConditions.length > 0) {
			if ((prisma as any).cadIteration) {
				await (prisma as any).cadIteration.deleteMany({
					where: {
						sessionId: id,
						OR: deleteConditions,
					},
				});
			} else {
				if (versionNum && !isNaN(versionNum)) {
					await prisma.$queryRawUnsafe(
						`DELETE FROM "CadIteration" WHERE "sessionId" = $1 AND ("version" = $2 OR "id" = $3)`,
						id,
						versionNum,
						iterationId || ''
					).catch(() => {});
				} else if (iterationId) {
					await prisma.$queryRawUnsafe(
						`DELETE FROM "CadIteration" WHERE "sessionId" = $1 AND "id" = $2`,
						id,
						iterationId
					).catch(() => {});
				}
			}
		}

		// 2. Fetch remaining iterations to sync parent CadSession
		let remaining: any[] = [];
		if ((prisma as any).cadIteration) {
			remaining = await (prisma as any).cadIteration.findMany({
				where: { sessionId: id },
				orderBy: { version: 'desc' },
			});
		} else {
			remaining = await prisma.$queryRawUnsafe<any[]>(
				`SELECT * FROM "CadIteration" WHERE "sessionId" = $1 ORDER BY "version" DESC`,
				id
			).catch(() => []);
		}

		// 3. Update the parent CadSession with the newest remaining iteration
		if (remaining.length > 0) {
			const latest = remaining[0];
			await prisma.cadSession.update({
				where: { id },
				data: {
					currentVersion: latest.version,
					pythonScript: latest.pythonScript,
					parameters: latest.parameters,
					annotations: latest.annotations,
					stlUrl: latest.stlUrl,
					stepUrl: latest.stepUrl,
					...(latest.prompt ? { prompt: latest.prompt } : {}),
				},
			});
		}

		return NextResponse.json({
			success: true,
			remainingCount: remaining.length,
			currentVersion: remaining[0]?.version || 1,
		});
	} catch (error) {
		console.error('Failed to delete session iteration:', error);
		return NextResponse.json({ error: 'Failed to delete iteration' }, { status: 500 });
	}
}


