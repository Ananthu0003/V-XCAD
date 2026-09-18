import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
	// VEX-006 / VEX-LATEST-09: Require authenticated session with tokenVersion validation
	const authUserId = await requireSession();
	if (!authUserId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to generate G-Code.' } },
			{ status: 401 }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: { message: 'Invalid JSON body.' } }, { status: 400 });
	}

	// VEX-REV-002: Verify session ownership if session_id or job_id is provided
	const targetSessionId = body?.session_id || body?.job_id;
	if (targetSessionId && typeof targetSessionId === 'string') {
		try {
			const session = await prisma.cadSession.findUnique({
				where: { id: targetSessionId },
				select: { userId: true, isShared: true },
			});
			if (session && session.userId !== authUserId && !session.isShared) {
				return NextResponse.json(
					{ error: { message: 'Forbidden', hint: 'You do not have access to this session.' } },
					{ status: 403 }
				);
			}
		} catch (dbError) {
			console.error('[CAM G-Code] Failed to verify session ownership:', dbError);
		}
	}

	let upstream: Response;
	try {
		upstream = await fetchWithTimeout(`${getFastApiUrl()}/cam/gcode`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(body),
			cache: 'no-store',
		}, 60000);
	} catch (error) {
		return NextResponse.json(
			{ error: { message: 'Unable to connect to AI engine.' } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok || !payload) {
		return NextResponse.json(
			{ error: { message: payload?.error?.message || 'G-Code generation failed.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
