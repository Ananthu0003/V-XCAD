import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
	// VEX-006 / VEX-LATEST-09: Require authenticated session with tokenVersion validation
	const authUserId = await requireSession();
	if (!authUserId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to access knowledge documents.' } },
			{ status: 401 }
		);
	}

	let upstream: Response;
	try {
		upstream = await fetchWithTimeout(`${getFastApiUrl()}/knowledge/documents`, {
			method: 'GET',
			cache: 'no-store',
		}, 30000);
	} catch (error) {
		return NextResponse.json(
			{ error: { message: 'Unable to connect to AI engine.' } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok || !payload) {
		return NextResponse.json(
			{ error: { message: payload?.error?.message || 'Failed to list documents.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
