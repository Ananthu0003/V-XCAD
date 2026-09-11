import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ErrorPayload = {
	error: {
		message: string;
		hint?: string;
	};
};

type LegacyRenderPayload = {
	script?: unknown;
	python_script?: unknown;
	parameters?: unknown;
	output_basename?: unknown;
	session_id?: unknown;
};

type FastApiRenderRequest = {
	python_script: string;
	parameters: Record<string, unknown>;
	session_id: string;
	cam_parameters?: Record<string, unknown>;
};

function buildError(message: string, hint?: string): ErrorPayload {
	const payload: ErrorPayload = {
		error: {
			message,
		},
	};

	if (hint) {
		payload.error.hint = hint;
	}

	return payload;
}

function extractErrorFromUnknown(input: unknown, fallback: string): { message: string; hint?: string } {
	if (input && typeof input === 'object') {
		const candidate = input as {
			error?: { message?: unknown; hint?: unknown };
			detail?: unknown;
			message?: unknown;
		};

		if (candidate.error && typeof candidate.error === 'object') {
			const message = typeof candidate.error.message === 'string' ? candidate.error.message : fallback;
			const hint = typeof candidate.error.hint === 'string' ? candidate.error.hint : undefined;
			return { message, hint };
		}

		if (typeof candidate.message === 'string' && candidate.message.trim()) {
			return { message: candidate.message.trim() };
		}

		if (typeof candidate.detail === 'string' && candidate.detail.trim()) {
			return { message: candidate.detail.trim() };
		}
	}

	if (typeof input === 'string' && input.trim()) {
		return { message: input.trim() };
	}

	return { message: fallback };
}

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) {
		throw new Error('FASTAPI_URL is not configured');
	}
	return value.replace(/\/$/, '');
}

function toSessionId(outputBasename: string): string {
	const trimmed = outputBasename.trim();
	if (!trimmed) {
		return crypto.randomUUID();
	}

	return trimmed.startsWith('cad_') ? trimmed.slice(4) : trimmed;
}

function toFastApiRenderRequest(value: unknown): FastApiRenderRequest | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const body = value as LegacyRenderPayload;
	const pythonScriptSource =
		typeof body.python_script === 'string' && body.python_script.trim()
			? body.python_script
			: typeof body.script === 'string' && body.script.trim()
				? body.script
				: null;

	if (!pythonScriptSource) {
		return null;
	}

	const parametersObj =
		body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
			? (body.parameters as Record<string, unknown>)
			: {};

	const sessionSource =
		typeof body.session_id === 'string' && body.session_id.trim()
			? body.session_id
			: typeof body.output_basename === 'string' && body.output_basename.trim()
				? toSessionId(body.output_basename)
				: crypto.randomUUID();

	return {
		python_script: pythonScriptSource,
		parameters: parametersObj,
		session_id: sessionSource,
		cam_parameters: (body as any).cam_parameters,
	};
}

export async function POST(request: Request): Promise<Response> {
	// ── VEX-2A-002: Require authenticated session ────────────────────────────
	// Unauthenticated requests must be rejected before any body parsing or
	// forwarding to the AI engine, preventing arbitrary code execution by
	// anonymous callers.
	const authSession = await getSession();
	if (!authSession?.userId) {
		return NextResponse.json(
			buildError('Authentication required.', 'Log in to use the render endpoint.'),
			{ status: 401 }
		);
	}

	// Validate the authenticated user still exists in the database.
	const userExists = await prisma.user.findUnique({
		where: { id: authSession.userId },
	});
	if (!userExists) {
		return NextResponse.json(
			buildError('Authentication required.', 'Log in to use the render endpoint.'),
			{ status: 401 }
		);
	}

	const authenticatedUserId = authSession.userId;
	// ── End VEX-2A-002 auth gate ─────────────────────────────────────────────

	let body: any = null;
	try {
		body = await request.json();
	} catch (err) {
		console.error('Failed to parse JSON body in /api/render:', err);
	}
	const headerSessionId = request.headers.get('x-session-id');

	// If body doesn't have session_id but header does, inject it.
	if (body && typeof body === 'object' && !body.session_id && headerSessionId) {
		body.session_id = headerSessionId;
	}

	const mappedPayload = toFastApiRenderRequest(body);
	if (!mappedPayload) {
		return NextResponse.json(
			buildError(
				'Request body must include python_script (or script) and a parameters object.',
				'Provide session_id or output_basename, or let the server generate one.'
			),
			{ status: 400 }
		);
	}

	// VEX-2A-012: Ownership check — verify the authenticated user owns the target session
	// before calling the ai-engine or allowing the upsert to overwrite existing session data.
	try {
		const existingSession = await prisma.cadSession.findUnique({
			where: { id: mappedPayload.session_id },
			select: { userId: true },
		});

		if (existingSession && existingSession.userId !== authenticatedUserId) {
			return NextResponse.json(
				buildError('Forbidden', 'You do not own this session.'),
				{ status: 403 }
			);
		}
	} catch (e) {
		console.warn('Could not verify session ownership for VEX-2A-012:', e);
	}

	// Determine next version for this session
	let nextVersion = 1;
	try {
		if ((prisma as any).cadIteration) {
			const latestIteration = await (prisma as any).cadIteration.findFirst({
				where: { sessionId: mappedPayload.session_id },
				select: { version: true },
				orderBy: { version: 'desc' },
			});

			if (latestIteration && typeof latestIteration.version === 'number') {
				nextVersion = latestIteration.version + 1;
			}
		} else {
			const rows = await prisma.$queryRawUnsafe<any[]>(
				`SELECT version FROM "CadIteration" WHERE "sessionId" = $1 ORDER BY version DESC LIMIT 1`,
				mappedPayload.session_id
			).catch(() => []);
			if (rows && rows.length > 0 && typeof rows[0].version === 'number') {
				nextVersion = rows[0].version + 1;
			}
		}
	} catch (e) {
		console.warn('Could not query previous versions for session, defaulting to 1:', e);
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/render`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json',
			},
			// Forward FastAPI schema fields including calculated iteration version
			body: JSON.stringify({
				...mappedPayload,
				version: nextVersion,
			}),
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			buildError(
				'Unable to connect to AI engine render endpoint.',
				error instanceof Error ? error.message : undefined
			),
			{ status: 502 }
		);
	}

	const upstreamData = await upstream.json().catch(() => null);
	if (!upstream.ok || !upstreamData || typeof upstreamData !== 'object') {
		const extracted = extractErrorFromUnknown(upstreamData, 'AI engine failed to render CAD model.');
		return NextResponse.json(buildError(extracted.message, extracted.hint), { status: upstream.status || 502 });
	}

	const data = upstreamData as Record<string, unknown>;
	const artifacts =
		data.artifacts && typeof data.artifacts === 'object' ? (data.artifacts as Record<string, unknown>) : null;
	const parametersJson = mappedPayload.parameters as Prisma.InputJsonValue;
	const stlUrl =
		typeof data.stl_url === 'string'
			? data.stl_url
			: artifacts && typeof artifacts.stl_url === 'string'
				? artifacts.stl_url
				: null;
	const stepUrl =
		typeof data.step_url === 'string'
			? data.step_url
			: artifacts && typeof artifacts.step_url === 'string'
				? artifacts.step_url
				: null;
	const dxfUrl =
		typeof data.dxf_url === 'string'
			? data.dxf_url
			: artifacts && typeof artifacts.dxf_url === 'string'
				? artifacts.dxf_url
				: null;

	const iterationPrompt = (body && typeof body.prompt === 'string' && body.prompt.trim()) ? body.prompt.trim() : null;
	const iterationSource = (body && typeof body.source === 'string' && body.source.trim()) ? body.source.trim() : 'editor_compile';

	try {
		// 1. Upsert the main CadSession
		await prisma.cadSession.upsert({
			where: { id: mappedPayload.session_id },
			update: {
				pythonScript: mappedPayload.python_script,
				parameters: parametersJson,
				annotations: artifacts && artifacts.annotations ? (artifacts.annotations as Prisma.InputJsonValue) : Prisma.DbNull,
				stlUrl,
				stepUrl,
				...(iterationPrompt ? { prompt: iterationPrompt } : {}),
			},
			create: {
				id: mappedPayload.session_id,
				prompt: iterationPrompt || 'Scripted CAD Design',
				pythonScript: mappedPayload.python_script,
				parameters: parametersJson,
				annotations: artifacts && artifacts.annotations ? (artifacts.annotations as Prisma.InputJsonValue) : Prisma.DbNull,
				stlUrl,
				stepUrl,
				userId: authenticatedUserId,
			},
		});

		// 2. Archive this immutable iteration snapshot (only for actual edits/prompts, not restores)
		if (iterationSource !== 'restore' && !body.is_restore) {
			if ((prisma as any).cadIteration) {
				await (prisma as any).cadIteration.create({
				data: {
					sessionId: mappedPayload.session_id,
					version: nextVersion,
					prompt: iterationPrompt,
					source: iterationSource,
					pythonScript: mappedPayload.python_script,
					parameters: parametersJson,
					annotations: artifacts && artifacts.annotations ? (artifacts.annotations as Prisma.InputJsonValue) : Prisma.DbNull,
					stlUrl,
					stepUrl,
					dxfUrl,
				},
			});
		} else {
			const itId = crypto.randomUUID();
			const paramStr = JSON.stringify(parametersJson || {});
			const annStr = artifacts && artifacts.annotations ? JSON.stringify(artifacts.annotations) : null;
			await prisma.$executeRawUnsafe(
				`INSERT INTO "CadIteration" ("id", "sessionId", "version", "prompt", "source", "pythonScript", "parameters", "annotations", "stlUrl", "stepUrl", "dxfUrl", "createdAt")
				 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, NOW())
				 ON CONFLICT ("sessionId", "version") DO UPDATE SET
				   "prompt" = EXCLUDED."prompt",
				   "source" = EXCLUDED."source",
				   "pythonScript" = EXCLUDED."pythonScript",
				   "parameters" = EXCLUDED."parameters",
				   "annotations" = EXCLUDED."annotations",
				   "stlUrl" = EXCLUDED."stlUrl",
				   "stepUrl" = EXCLUDED."stepUrl",
				   "dxfUrl" = EXCLUDED."dxfUrl"`,
				itId,
				mappedPayload.session_id,
				nextVersion,
				iterationPrompt,
				iterationSource,
				mappedPayload.python_script,
				paramStr,
				annStr,
				stlUrl,
				stepUrl,
				dxfUrl
			);
		}
	}
	} catch (dbErr) {
		console.error('Failed to save iteration to database:', dbErr);
	}

	const normalizedResponse = {
		...data,
		stl_url: stlUrl,
		step_url: stepUrl,
		dxf_url: dxfUrl,
		version: nextVersion,
	};

	return NextResponse.json(normalizedResponse, {
		status: upstream.status,
	});
}
