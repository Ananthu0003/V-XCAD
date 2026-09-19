import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) throw new Error('FASTAPI_URL is not configured');
	return value.replace(/\/$/, '');
}

function getServiceApiKey(): string {
	const value = process.env.SERVICE_API_KEY?.trim();
	if (!value) throw new Error('SERVICE_API_KEY is not configured');
	return value;
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ docId: string }> }
): Promise<Response> {
	const adminId = await requireAdmin();
	if (!adminId) {
		return NextResponse.json(
			{ error: { message: 'Forbidden. Administrator access required.' } },
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
			headers: { 'X-Service-Key': getServiceApiKey() },
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
