import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ jobId: string; simulationRunId: string }> }
) {
	// VEX-2A-003: Require authenticated session
	if (!(await requireSession())) {
		return NextResponse.json({ error: { message: 'Authentication required.' } }, { status: 401 });
	}
	try {
		const { simulationRunId: runId } = await params;
		if (!runId) {
			return NextResponse.json({ error: { message: 'Missing simulationRunId' } }, { status: 400 });
		}

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

		return NextResponse.json({
			status: 'ok',
			simulationRun: simRun
		});
	} catch (error) {
		console.error("Error fetching simulation:", error);
		return NextResponse.json({ error: { message: 'Internal server error.' } }, { status: 500 });
	}
}
