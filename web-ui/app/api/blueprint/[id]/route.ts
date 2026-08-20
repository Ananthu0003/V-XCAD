import { NextRequest, NextResponse } from 'next/server';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim() || process.env.AI_ENGINE_URL?.trim() || 'http://127.0.0.1:8001/api/v1';
	return value.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	if (!id) {
		return new NextResponse('Session ID required', { status: 400 });
	}

	try {
		const upstream = await fetch(`${getFastApiUrl()}/api/v1/blueprint/${id}`, {
			cache: 'no-store',
		});

		if (!upstream.ok) {
			return new NextResponse('Blueprint not found', { status: upstream.status });
		}

		const blob = await upstream.blob();
		return new NextResponse(blob, {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'public, max-age=3600',
			},
		});
	} catch (e) {
		console.error('[Blueprint Proxy Error]', e);
		return new NextResponse('Failed to proxy blueprint', { status: 502 });
	}
}
