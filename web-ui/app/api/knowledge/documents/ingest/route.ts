import { NextResponse } from 'next/server';

import { requireAdmin, requireSession } from '@/lib/auth';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
	// Require authenticated session
	const userId = await requireSession();
	if (!userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Sign in to access this resource.' } },
			{ status: 401 }
		);
	}

	// Require administrative session
	const admin = await requireAdmin();
	if (!admin) {
		return NextResponse.json(
			{ error: { message: 'Forbidden: Admin access required.', hint: 'Administrative privileges are required to ingest documents.' } },
			{ status: 403 }
		);
	}

	// Forward the multipart form data as-is (do not set Content-Type — fetch auto-sets boundary)
	const formData = await request.formData();

	let upstream: Response;
	try {
		upstream = await fetchWithTimeout(`${getFastApiUrl()}/knowledge/documents/ingest`, {
			method: 'POST',
			body: formData,
			cache: 'no-store',
		}, 120000);
	} catch (error) {
		return NextResponse.json(
			{ error: { message: 'Unable to connect to AI engine.' } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok || !payload) {
		return NextResponse.json(
			{ error: { message: payload?.error?.message || 'Document ingestion failed.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
