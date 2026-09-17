import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OUTPUTS_DIR = '/app/outputs';

const MIME_TYPES: Record<string, string> = {
	'.stl': 'model/stl',
	'.step': 'application/step',
	'.stp': 'application/step',
	'.dxf': 'application/dxf',
	'.gcode': 'text/plain',
	'.ngc': 'text/plain',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
};

/**
 * VEX-2A-004: Extract the owning session ID from an output filename.
 *
 * The ai-engine produces files named:
 *   cad_{session_id}.{ext}            (e.g. cad_abc123.stl)
 *   cad_{session_id}_v{N}.{ext}       (versioned, e.g. cad_abc123_v2.step)
 *   cad_{session_id}.py.txt           (script backup)
 *   cad_{session_id}_annotations.json (annotations)
 *
 * Returns the session_id if the filename matches one of these patterns,
 * or null if the file is not session-derived.
 */
function extractSessionIdFromFilename(filename: string): string | null {
	if (!filename.startsWith('cad_')) return null;
	const body = filename.slice(4);

	// Session IDs are CUIDs/UUIDs: alphanumeric + hyphens only.
	// Find where the session ID ends (first non-alphanumeric-hyphen char).
	const match = body.match(/^([a-zA-Z0-9-]+)/);
	return match ? match[1] : null;
}

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
	// VEX-006: Require authenticated session
	const authSession = await getSession();
	if (!authSession?.userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to access files.' } },
			{ status: 401 }
		);
	}
	const userExists = await prisma.user.findUnique({ where: { id: authSession.userId } });
	if (!userExists) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to access files.' } },
			{ status: 401 }
		);
	}

	const { path } = await params;
	const filePath = path.join('/');

	// Prevent path traversal — only allow flat filenames in /outputs
	if (filePath.includes('..') || filePath.includes('/') || filePath.includes('\\')) {
		return NextResponse.json({ error: { message: 'Invalid file path.' } }, { status: 400 });
	}

	// VEX-NEW-01/02: Only allow access to session-derived artifacts with valid ownership.
	// Non-session files (no cad_ prefix) are denied. Orphaned files (session deleted from
	// DB) are denied to prevent data leakage from stale disk artifacts.
	const sessionId = extractSessionIdFromFilename(filePath);
	if (!sessionId) {
		return NextResponse.json(
			{ error: { message: 'Forbidden' } },
			{ status: 403 }
		);
	}

	const session = await prisma.cadSession.findUnique({
		where: { id: sessionId },
		select: { userId: true, isShared: true },
	});

	if (!session) {
		return NextResponse.json(
			{ error: { message: 'Forbidden' } },
			{ status: 403 }
		);
	}

	const isOwner = session.userId === authSession.userId;
	const isShared = session.isShared;
	const isNullUser = session.userId === null;

	if (!isOwner && !isShared && !isNullUser) {
		return NextResponse.json(
			{ error: { message: 'Forbidden' } },
			{ status: 403 }
		);
	}
	if (isNullUser && !isOwner) {
		return NextResponse.json(
			{ error: { message: 'Forbidden' } },
			{ status: 403 }
		);
	}

	const fullPath = join(OUTPUTS_DIR, filePath);

	try {
		const data = await readFile(fullPath);
		const ext = extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		return new Response(data, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'private, no-store',
			},
		});
	} catch {
		return NextResponse.json({ error: { message: 'File not found.' } }, { status: 404 });
	}
}
