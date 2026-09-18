import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, requireSession } from '@/lib/auth';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ docId: string }> }
): Promise<Response> {
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
			{ error: { message: 'Forbidden: Admin access required.', hint: 'Administrative privileges are required to delete documents.' } },
			{ status: 403 }
		);
	}

	const { docId } = await params;
	if (!docId) {
		return NextResponse.json({ error: { message: 'Missing document ID.' } }, { status: 400 });
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/knowledge/documents/${docId}`, {
			method: 'DELETE',
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			{ error: { message: 'Unable to connect to AI engine.' } },
			{ status: 502 }
		);
	}

	const payload = await upstream.json().catch(() => null);
	if (!upstream.ok) {
		return NextResponse.json(
			{ error: { message: payload?.error?.message || 'Document deletion failed.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload || { status: 'ok' });
}
