import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: any) {
	try {
		const { id } = await context.params;
		const authSession = await getSession();
		const session = await prisma.cadSession.findUnique({
			where: { id },
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		// VEX-009: Explicit ownership/shared semantics.
		// Owner: allowed.  Shared session: allowed (including unauthenticated for share page).
		// Null-user / other user's private: forbidden.
		const isOwner = authSession?.userId && session.userId === authSession.userId;
		const isShared = session.isShared;

		if (!isOwner && !isShared) {
			return NextResponse.json(
				{ error: authSession?.userId ? 'Forbidden' : 'Unauthorized' },
				{ status: authSession?.userId ? 403 : 401 }
			);
		}

		return NextResponse.json(session);
	} catch (error) {
		console.error('Failed to load session:', error);
		return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
	}
}

export async function DELETE(request: Request, context: any) {
	try {
		const { id } = await context.params;
		const authSession = await getSession();
		if (!authSession?.userId) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}

		const session = await prisma.cadSession.findUnique({
			where: { id },
			select: { userId: true },
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		// VEX-2A-005: Only the owner may delete their session.
		// Shared status and null-user sessions do not grant deletion rights.
		if (session.userId !== authSession.userId) {
			return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
		}

		await prisma.cadSession.delete({
			where: { id },
		});

		return NextResponse.json({ message: 'Session deleted' });
	} catch (error) {
		console.error('Failed to delete session:', error);
		return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
	}
}

export async function PATCH(request: Request, context: any) {
	try {
		const { id } = await context.params;
		const authSession = await getSession();
		if (!authSession?.userId) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}
		const body = await request.json();

		const session = await prisma.cadSession.findUnique({
			where: { id },
			select: { id: true, userId: true },
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		// VEX-009: Only the owner may modify their session.
		// Shared status does NOT grant write permission.
		if (session.userId !== authSession.userId) {
			return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
		}

		const updated = await prisma.cadSession.update({
			where: { id },
			data: {
				...(body.currentVersion !== undefined ? { currentVersion: body.currentVersion } : {}),
				...(body.pythonScript !== undefined ? { pythonScript: body.pythonScript } : {}),
				...(body.parameters !== undefined ? { parameters: body.parameters } : {}),
				...(body.annotations !== undefined ? { annotations: body.annotations } : {}),
				...(body.stlUrl !== undefined ? { stlUrl: body.stlUrl } : {}),
				...(body.stepUrl !== undefined ? { stepUrl: body.stepUrl } : {}),
				...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
			},
		});

		return NextResponse.json(updated);
	} catch (error) {
		console.error('Failed to update session:', error);
		return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
	}
}

