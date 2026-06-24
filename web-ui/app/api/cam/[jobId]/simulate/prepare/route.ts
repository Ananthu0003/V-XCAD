import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) {
		throw new Error('FASTAPI_URL is not configured');
	}
	return value.replace(/\/$/, '');
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ jobId: string }> }
): Promise<Response> {
	const { jobId } = await params;
	if (!jobId) {
		return NextResponse.json({ error: { message: 'Missing jobId' } }, { status: 400 });
	}

	const body = await request.json().catch(() => null);
	if (!body || !body.setup || !body.operations) {
		return NextResponse.json({ error: { message: 'Missing setup or operations in body' } }, { status: 400 });
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/cam/simulate/prepare`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json',
			},
			body: JSON.stringify({
				setup: body.setup,
				tools: body.tools || [],
				operations: body.operations,
			}),
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			{ error: { message: 'Unable to connect to AI engine simulation endpoint.' } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok || !payload) {
		return NextResponse.json({ error: { message: payload?.error?.message || 'Simulation generation failed.' } }, { status: upstream.status || 500 });
	}

	const runId = payload.simulationRunId;
	const simRun = payload.simulationRun;
	const setup = payload.setup;
	const segments = payload.segments || [];
	const events = payload.timeline || [];

	try {
		// Persist using Prisma transaction
		await prisma.$transaction(async (tx) => {
			// 1. Setup
			let setupId = setup.id || `setup_${jobId}`;
			const existingSetup = await tx.camSetup.findUnique({ where: { id: setupId } });
			if (!existingSetup) {
				await tx.camSetup.create({
					data: {
						id: setupId,
						job_id: jobId,
						stock_length: setup.stock_length,
						stock_width: setup.stock_width,
						stock_height: setup.stock_height,
						wcs: setup.wcs,
					}
				});
			}

			// 1.5 Tools
			const validToolIds = new Set<string>();
			for (const t of (payload.tools || [])) {
				if (!t) continue;
				const tid = t.id || t.dbId || `tool_${Date.now()}`;
				validToolIds.add(tid);
				const existingTool = await tx.camTool.findUnique({ where: { id: tid } });
				if (!existingTool) {
					await tx.camTool.create({
						data: {
							id: tid,
							setup_id: setupId,
							tool_type: t.tool_type || t.type || 'flat_end_mill',
							diameter_mm: t.diameter || t.diameter_mm || 6,
							length_mm: t.length || t.length_mm || 50,
							flute_count: t.flute_count || t.flutes || 2,
						}
					});
				}
			}

			// 1.6 Operations
			const validOpIds = new Set<string>();
			for (const op of (payload.operations || [])) {
				if (!op) continue;
				const oid = op.id || `op_${Date.now()}`;
				validOpIds.add(oid);
				let opToolId = op.tool_id || op.toolId;
				if (!opToolId || !validToolIds.has(opToolId)) {
					// Fallback to first tool if missing/invalid
					opToolId = Array.from(validToolIds)[0] || '';
				}
				
				if (!opToolId) continue; // Can't insert op without tool

				const existingOp = await tx.camOperation.findUnique({ where: { id: oid } });
				if (!existingOp) {
					await tx.camOperation.create({
						data: {
							id: oid,
							setup_id: setupId,
							tool_id: opToolId,
							operation_type: op.operation_type || op.type || 'contour',
							operation_order: op.operation_order || op.order || 0,
						}
					});
				}
			}

			// 2. SimulationRun
			await tx.simulationRun.create({
				data: {
					id: runId,
					job_id: jobId,
					setup_id: setupId,
					total_runtime_sec: simRun.total_runtime_sec,
					total_distance_mm: simRun.total_distance_mm,
					cutting_distance_mm: simRun.cutting_distance_mm,
					rapid_distance_mm: simRun.rapid_distance_mm,
					status: simRun.status,
					validation_status: simRun.validation_status,
					validation_errors: Array.isArray(simRun.validation_errors) ? simRun.validation_errors.join('\n') : simRun.validation_errors,
					validation_warnings: Array.isArray(simRun.validation_warnings) ? simRun.validation_warnings.join('\n') : simRun.validation_warnings,
				}
			});

			// 3. Insert Segments (chunked to prevent query size limit)
			const chunkSize = 1000;
			for (let i = 0; i < segments.length; i += chunkSize) {
				const chunk = segments.slice(i, i + chunkSize).map((seg: any) => ({
					id: seg.id,
					simulation_run_id: runId,
					operation_id: validOpIds.has(seg.operation_id) ? seg.operation_id : undefined,
					tool_id: validToolIds.has(seg.tool_id) ? seg.tool_id : undefined,
					segment_index: seg.segment_index,
					move_type: seg.move_type,
					start_x: seg.start_x,
					start_y: seg.start_y,
					start_z: seg.start_z,
					start_i: seg.start_i,
					start_j: seg.start_j,
					start_k: seg.start_k,
					end_x: seg.end_x,
					end_y: seg.end_y,
					end_z: seg.end_z,
					end_i: seg.end_i,
					end_j: seg.end_j,
					end_k: seg.end_k,
					feed_rate: seg.feed_rate,
					rpm: seg.rpm,
					length_mm: seg.length_mm,
					estimated_time_sec: seg.estimated_time_sec
				}));
				await tx.toolpathSegment.createMany({ data: chunk, skipDuplicates: true });
			}

			// 4. Insert Events
			if (events.length > 0) {
				await tx.simulationEvent.createMany({
					data: events.map((ev: any) => ({
						id: ev.id,
						simulation_run_id: runId,
						event_type: ev.event_type,
						time_sec: ev.time_sec,
						operation_id: validOpIds.has(ev.operation_id) ? ev.operation_id : undefined,
						tool_id: validToolIds.has(ev.tool_id) ? ev.tool_id : undefined,
						message: ev.message
					})),
					skipDuplicates: true
				});
			}
		}, { timeout: 60000, maxWait: 10000 });

		return NextResponse.json({
			status: 'ok',
			simulationRunId: runId,
			totalSegments: segments.length,
			totalEvents: events.length
		});
	} catch (error) {
		console.error("Database persistence failed:", error);
		const errMsg = error instanceof Error ? error.message : String(error);
		return NextResponse.json({ error: { message: `Failed to persist simulation data: ${errMsg}` } }, { status: 500 });
	}
}
