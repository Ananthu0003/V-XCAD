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

		const events = await prisma.simulationEvent.findMany({
			where: { simulation_run_id: runId },
			orderBy: { time_sec: 'asc' }
		});

		return NextResponse.json({
			status: 'ok',
			events
		});
	} catch (error) {
		console.error("Error fetching timeline:", error);
		return NextResponse.json({ error: { message: 'Internal server error.' } }, { status: 500 });
	}
}
