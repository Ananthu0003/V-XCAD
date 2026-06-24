import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(
	request: Request,
	{ params }: { params: { jobId: string; simulationRunId: string } }
) {
	try {
		const runId = params.simulationRunId;
		if (!runId) {
			return NextResponse.json({ error: { message: 'Missing simulationRunId' } }, { status: 400 });
		}

		const simRun = await prisma.simulationRun.findUnique({
			where: { id: runId },
			include: {
				setup: true,
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
