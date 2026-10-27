import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { aiEngineFetch } from '@/lib/aiEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) throw new Error('FASTAPI_URL is not configured');
	return value.replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	// Require authenticated session
	const authSession = await getSession();
	if (!authSession?.userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to view setup sheets.' } },
			{ status: 401 }
		);
	}
	const userExists = await prisma.user.findUnique({ where: { id: authSession.userId } });
	if (!userExists) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to view setup sheets.' } },
			{ status: 401 }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: { message: 'Invalid JSON body.' } }, { status: 400 });
	}

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
	const upstreamBody = {
		session_id: sessionId,
		job_id: sessionId,
	};

	let upstream: Response;
	try {
		upstream = await aiEngineFetch(`${getFastApiUrl()}/cam/setup_sheets`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(upstreamBody),
			cache: 'no-store',
		});
	} catch (error) {
		console.error('[cam-setup-sheets] AI engine fetch failed:', error);
		const detail = error instanceof Error ? error.message : String(error);
		return NextResponse.json(
			{ error: { message: `Unable to connect to AI engine: ${detail}` } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok || !payload) {
		return NextResponse.json(
			{ error: { message: payload?.error?.message || 'Failed to retrieve setup sheets.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
