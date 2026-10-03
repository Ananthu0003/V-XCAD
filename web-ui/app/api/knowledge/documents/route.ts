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

export async function GET(): Promise<Response> {
	const adminId = await requireAdmin();
	if (!adminId) {
		return NextResponse.json(
			{ error: { message: 'Forbidden. Administrator access required.' } },
			{ status: 403 }
		);
	}

	let upstream: Response;
	try {
		upstream = await aiEngineFetch(`${getFastApiUrl()}/knowledge/documents`, {
			method: 'GET',
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
			{ error: { message: payload?.error?.message || 'Failed to list documents.' } },
			{ status: upstream.status || 502 }
		);
	}

	return NextResponse.json(payload);
}
