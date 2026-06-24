import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ jobId: string; simulationRunId: string }> }
) {
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
