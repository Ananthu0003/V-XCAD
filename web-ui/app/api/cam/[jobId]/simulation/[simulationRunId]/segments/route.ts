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
		const { searchParams } = new URL(request.url);
		const skip = parseInt(searchParams.get('skip') || '0', 10);
		const take = parseInt(searchParams.get('take') || '1000', 10);

		const { simulationRunId: runId } = await params;
		if (!runId) {
			return NextResponse.json({ error: { message: 'Missing simulationRunId' } }, { status: 400 });
		}

		const segments = await prisma.toolpathSegment.findMany({
			where: { simulation_run_id: runId },
			orderBy: { segment_index: 'asc' },
			skip,
			take
		});

		const totalCount = await prisma.toolpathSegment.count({
			where: { simulation_run_id: runId }
		});

		return NextResponse.json({
			status: 'ok',
			segments,
			pagination: {
				skip,
				take,
				total: totalCount,
				hasMore: skip + take < totalCount
			}
		});
	} catch (error) {
		console.error("Error fetching segments:", error);
		return NextResponse.json({ error: { message: 'Internal server error.' } }, { status: 500 });
	}
}
