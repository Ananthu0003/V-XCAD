import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) throw new Error('FASTAPI_URL is not configured');
	return value.replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	// VEX-006: Require authenticated session
	const authSession = await getSession();
	if (!authSession?.userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to generate toolpaths.' } },
			{ status: 401 }
		);
	}
	const userExists = await prisma.user.findUnique({ where: { id: authSession.userId } });
	if (!userExists) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to generate toolpaths.' } },
			{ status: 401 }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: { message: 'Invalid JSON body.' } }, { status: 400 });
	}

	// VEX-SEC: session_id is mandatory and must be owned by the caller.
	// P1-NEW-01: the ai-engine keys CAM artifacts by job_id, so job_id is derived
	// here from the authorized session_id and is never taken from the client.
	const sessionId = body?.session_id;
	if (typeof sessionId !== 'string' || !sessionId) {
		return NextResponse.json({ error: { message: 'session_id is required.' } }, { status: 400 });
	}
	const session = await prisma.cadSession.findUnique({
		where: { id: sessionId },
		select: { userId: true },
	});
	if (!session || session.userId !== authSession.userId) {
		return NextResponse.json(
			{ error: { message: 'Forbidden', hint: 'You do not own this session.' } },
			{ status: 403 }
		);
	}
	const upstreamBody = { ...body, session_id: sessionId, job_id: sessionId };

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/cam/toolpaths`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(upstreamBody),
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			{ error: { message: 'Unable to connect to AI engine.' } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok || !payload) {
		return NextResponse.json(
			{ error: { message: payload?.error?.message || 'Toolpath generation failed.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
