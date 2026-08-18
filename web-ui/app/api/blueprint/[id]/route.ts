import { NextRequest, NextResponse } from 'next/server';

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8001';

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
		const upstream = await fetch(`${AI_ENGINE_URL}/api/v1/blueprint/${id}`, {
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
