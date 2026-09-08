import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) throw new Error('FASTAPI_URL is not configured');
	return value.replace(/\/$/, '');
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ docId: string }> }
): Promise<Response> {
	// VEX-006: Require authenticated session
	const authSession = await getSession();
	if (!authSession?.userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to delete documents.' } },
			{ status: 401 }
		);
	}
	const userExists = await prisma.user.findUnique({ where: { id: authSession.userId } });
	if (!userExists) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to delete documents.' } },
			{ status: 401 }
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
