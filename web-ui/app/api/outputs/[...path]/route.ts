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

	const fullPath = join(OUTPUTS_DIR, filePath);

	try {
		const data = await readFile(fullPath);
		const ext = extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		return new Response(data, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=3600',
			},
		});
	} catch {
		return NextResponse.json({ error: { message: 'File not found.' } }, { status: 404 });
	}
}
