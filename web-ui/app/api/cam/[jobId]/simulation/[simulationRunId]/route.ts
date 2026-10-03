import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ jobId: string; simulationRunId: string }> }
) {
	// VEX-2A-003: Require authenticated session
	const session = await requireSession();
	if (!session) {
		return NextResponse.json({ error: { message: 'Authentication required.' } }, { status: 401 });
	}
	try {
		const { jobId, simulationRunId: runId } = await params;
		if (!runId) {
			return NextResponse.json({ error: { message: 'Missing simulationRunId' } }, { status: 400 });
		}

		// VEX-2A-014: Verify the simulation run exists AND belongs to the supplied jobId
		const simRun = await prisma.simulationRun.findUnique({
			where: { id: runId },
			include: {
				setup: true,
				segments: true,
			}
		});

		if (!simRun) {
			return NextResponse.json({ error: { message: 'Simulation run not found.' } }, { status: 404 });
		}

		if (simRun.job_id !== jobId) {
			return NextResponse.json({ error: { message: 'Forbidden', hint: 'Simulation run does not belong to this session.' } }, { status: 403 });
		}

		// VEX-2A-014: Verify the parent CadSession is accessible to the authenticated user
		const parentSession = await prisma.cadSession.findUnique({
			where: { id: jobId },
			select: { userId: true, isShared: true },
		});

		if (!parentSession) {
			return NextResponse.json({ error: { message: 'Session not found.' } }, { status: 404 });
		}

		if (parentSession.userId !== session && !parentSession.isShared) {
			return NextResponse.json({ error: { message: 'Forbidden', hint: 'You do not own this session.' } }, { status: 403 });
		}

		return NextResponse.json({
			status: 'ok',
			simulationRun: simRun
		});
	} catch (error) {
		console.error("Error fetching simulation:", error);
		return NextResponse.json({ error: { message: 'Internal server error.' } }, { status: 500 });
	}
}
