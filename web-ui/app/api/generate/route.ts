import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ErrorPayload = {
	error: {
		message: string;
		hint?: string;
	};
	session_id?: string;
};

function buildError(message: string, hint?: string, sessionId?: string): ErrorPayload {
	const payload: ErrorPayload = {
		error: {
			message,
		},
	};

	if (hint) {
		payload.error.hint = hint;
	}

	if (sessionId) {
		payload.session_id = sessionId;
	}

	return payload;
}

function extractErrorFromUnknown(input: unknown, fallback: string): { message: string; hint?: string } {
	if (input && typeof input === 'object') {
		const candidate = input as {
			error?: { message?: unknown; hint?: unknown };
			detail?: unknown;
			message?: unknown;
		};

		if (candidate.error && typeof candidate.error === 'object') {
			const message = typeof candidate.error.message === 'string' ? candidate.error.message : fallback;
			const hint = typeof candidate.error.hint === 'string' ? candidate.error.hint : undefined;
			return { message, hint };
		}

		if (typeof candidate.message === 'string' && candidate.message.trim()) {
			return { message: candidate.message.trim() };
		}

		if (typeof candidate.detail === 'string' && candidate.detail.trim()) {
			return { message: candidate.detail.trim() };
		}
	}

	if (typeof input === 'string' && input.trim()) {
		return { message: input.trim() };
	}

	return { message: fallback };
}

function isSupportedUpload(upload: File): boolean {
	const mimeType = upload.type.toLowerCase();
	if (mimeType.startsWith('image/')) {
		return true;
	}

	if (mimeType === 'application/pdf') {
		return true;
	}

	return upload.name.toLowerCase().endsWith('.pdf');
}

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	return (value || 'http://127.0.0.1:8000/api/v1').replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	let formData: FormData;
	try {
		formData = await request.clone().formData();
	} catch {
		return NextResponse.json(buildError('Request must be multipart/form-data.'), { status: 400 });
	}

	const promptRaw = formData.get('prompt');
	const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : '';
	if (!prompt) {
		return NextResponse.json(buildError('Prompt is required.'), { status: 400 });
	}

	const upload = formData.get('image');
	if (upload && !(upload instanceof File)) {
		return NextResponse.json(buildError('Uploaded file must be an image or PDF.'), { status: 400 });
	}

	if (upload && upload instanceof File && !isSupportedUpload(upload)) {
		return NextResponse.json(buildError('Uploaded file must be an image or PDF.'), { status: 400 });
	}

	const modelRaw = formData.get('model_name');
	const modelName = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : 'gemini-3.5-flash';
	// FastAPI expects the field named 'model' (alias), not 'model_name'
	formData.delete('model_name');
	formData.set('model', modelName);

	const authSession = await getSession();
	let validUserId: string | null = null;
	if (authSession?.userId) {
		const userExists = await prisma.user.findUnique({
			where: { id: authSession.userId }
		});
		if (userExists) {
			validUserId = authSession.userId;
		}
	}

	const session = await prisma.cadSession.create({
		data: {
			prompt,
			fileName: (upload instanceof File) ? upload.name : null,
			userId: validUserId,
		},
	});

	// If no file was uploaded, remove the empty image field so FastAPI treats it as optional
	if (!(upload instanceof File)) {
		formData.delete('image');
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/generate`, {
			method: 'POST',
			body: formData,
			headers: {
				accept: 'text/event-stream',
			},
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			buildError(
				'Unable to connect to AI engine.',
				error instanceof Error ? error.message : undefined,
				session.id
			),
			{ status: 502 }
		);
	}

	if (!upstream.ok || !upstream.body) {
		const parsed = await upstream.json().catch(() => null);
		const extracted = extractErrorFromUnknown(parsed, 'AI engine failed to generate script.');
		return NextResponse.json(buildError(extracted.message, extracted.hint, session.id), {
			status: upstream.status || 502,
		});
	}

	const headers = new Headers();
	headers.set('content-type', upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8');
	headers.set('cache-control', 'no-cache, no-transform');
	headers.set('x-accel-buffering', 'no');
	headers.set('x-session-id', session.id);

	// Return the upstream ReadableStream directly so SSE chunks are not buffered.
	return new Response(upstream.body, {
		status: upstream.status,
		headers,
	});
}
