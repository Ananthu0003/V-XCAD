import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sessionPatchSchema = z.object({
  currentVersion: z.number().int().positive().optional(),
  pythonScript: z.string().optional(),
  parameters: z.any().optional(),
  annotations: z.any().optional(),
  stlUrl: z.string().url().optional().nullable(),
  stepUrl: z.string().url().optional().nullable(),
  prompt: z.string().optional(),
}).strict();

export async function GET(request: Request, context: any) {
	try {
		const { id } = await context.params;
		const authUserId = await requireSession();
		const session = await prisma.cadSession.findUnique({
			where: { id },
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		// VEX-009: Explicit ownership/shared semantics.
		// Owner: allowed.  Shared session: allowed (including unauthenticated for share page).
		// Null-user / other user's private: forbidden.
		const isOwner = authUserId && session.userId === authUserId;
		const isShared = session.isShared;

		if (!isOwner && !isShared) {
			return NextResponse.json(
				{ error: authUserId ? 'Forbidden' : 'Unauthorized' },
				{ status: authUserId ? 403 : 401 }
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
		const authUserId = await requireSession();
		if (!authUserId) {
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
		if (session.userId !== authUserId) {
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
		const authUserId = await requireSession();
		if (!authUserId) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
		}
		const body = await request.json();

		const parsed = sessionPatchSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json(
				{ error: 'Validation failed', details: parsed.error.issues },
				{ status: 400 }
			);
		}

		const session = await prisma.cadSession.findUnique({
			where: { id },
			select: { id: true, userId: true },
		});

		if (!session) {
			return NextResponse.json({ error: 'Session not found' }, { status: 404 });
		}

		// VEX-009: Only the owner may modify their session.
		// Shared status does NOT grant write permission.
		if (session.userId !== authUserId) {
			return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
		}

		const data = parsed.data;
		const updated = await prisma.cadSession.update({
			where: { id },
			data: {
				...(data.currentVersion !== undefined ? { currentVersion: data.currentVersion } : {}),
				...(data.pythonScript !== undefined ? { pythonScript: data.pythonScript } : {}),
				...(data.parameters !== undefined ? { parameters: data.parameters } : {}),
				...(data.annotations !== undefined ? { annotations: data.annotations } : {}),
				...(data.stlUrl !== undefined ? { stlUrl: data.stlUrl } : {}),
				...(data.stepUrl !== undefined ? { stepUrl: data.stepUrl } : {}),
				...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
			},
		});

		return NextResponse.json(updated);
	} catch (error) {
		console.error('Failed to update session:', error);
		return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
	}
}

