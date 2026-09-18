import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * VEX-2A-004: Verify the caller is authorized to access this session's blueprint.
 * Returns the CadSession if authorized, or a NextResponse error if not.
 */
async function authorizeSessionAccess(
	sessionId: string,
	userId: string
): Promise<{ session: { userId: string | null; isShared: boolean } } | { error: NextResponse }> {
	const session = await prisma.cadSession.findUnique({
		where: { id: sessionId },
		select: { userId: true, isShared: true },
	});

	if (!session) {
		return {
			error: NextResponse.json(
				{ error: { message: 'Session not found.' } },
				{ status: 404 }
			),
		};
	}

	// Owner can always access their own session.
	if (session.userId === userId) {
		return { session };
	}

	// Shared sessions are accessible to any authenticated user.
	if (session.isShared) {
		return { session };
	}

	if (session.userId === null) {
		return {
			error: NextResponse.json(
				{ error: { message: 'Forbidden' } },
				{ status: 403 }
			),
		};
	}

	// All other cases: different owner, not shared.
	return {
		error: NextResponse.json(
			{ error: { message: 'Forbidden' } },
			{ status: 403 }
		),
	};
}

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	// VEX-006 / VEX-LATEST-09: Require authenticated session with tokenVersion validation
	const authUserId = await requireSession();
	if (!authUserId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to access blueprints.' } },
			{ status: 401 }
		);
	}

	const { id } = await params;
	if (!id) {
		return new NextResponse('Session ID required', { status: 400 });
	}

	// VEX-2A-004: Enforce ownership before proxying to ai-engine
	const accessCheck = await authorizeSessionAccess(id, authUserId);
	if ('error' in accessCheck) {
		return accessCheck.error;
	}

	try {
		const upstream = await fetchWithTimeout(`${getFastApiUrl()}/blueprint/${id}`, {
			cache: 'no-store',
		}, 30000);

		if (!upstream.ok) {
			return new NextResponse('Blueprint not found', { status: upstream.status });
		}

		const blob = await upstream.blob();
		return new NextResponse(blob, {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'private, max-age=3600',
			},
		});
	} catch (e) {
		console.error('[Blueprint Proxy Error]', e);
		return new NextResponse('Failed to proxy blueprint', { status: 502 });
	}
}
