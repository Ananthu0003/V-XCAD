import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
	// VEX-006 / VEX-LATEST-09: Require authenticated session with tokenVersion validation
	const authUserId = await requireSession();
	if (!authUserId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to search knowledge.' } },
			{ status: 401 }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: { message: 'Invalid JSON body.' } }, { status: 400 });
	}

	let upstream: Response;
	try {
		upstream = await fetchWithTimeout(`${getFastApiUrl()}/knowledge/retrieve`, {
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
			{ error: { message: payload?.error?.message || 'Knowledge retrieval failed.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
