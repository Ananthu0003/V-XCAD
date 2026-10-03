import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth';
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
	const adminId = await requireAdmin();
	if (!adminId) {
		return NextResponse.json(
			{ error: { message: 'Forbidden. Administrator access required.' } },
			{ status: 403 }
		);
	}

	// Forward the multipart form data as-is (do not set Content-Type — fetch auto-sets boundary)
	const formData = await request.formData();

	let upstream: Response;
	try {
		upstream = await aiEngineFetch(`${getFastApiUrl()}/knowledge/documents/ingest`, {
			method: 'POST',
			body: formData,
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
			{ error: { message: payload?.error?.message || 'Document ingestion failed.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
