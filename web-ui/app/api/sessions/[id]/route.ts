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

		const userId = authSession?.userId || null;
		if (session.userId !== userId && !session.isShared && session.userId !== null) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
		const userId = authSession?.userId || null;

		const session = await prisma.cadSession.findUnique({
			where: { id },
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		if (session.userId !== userId && !session.isShared && session.userId !== null) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
