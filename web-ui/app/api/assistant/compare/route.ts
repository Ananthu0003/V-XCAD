import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	return (value || 'http://127.0.0.1:8001/api/v1').replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	try {
		const body = await request.json();
		const fastApiUrl = `${getFastApiUrl()}/assistant/compare-and-prompt`;

		const response = await fetch(fastApiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text();
			return NextResponse.json(
				{ error: `FastAPI error (${response.status}): ${errorText}` },
				{ status: response.status }
			);
		}

		const data = await response.json();
		return NextResponse.json(data);
	} catch (error: any) {
		return NextResponse.json(
			{ error: error?.message || 'Failed to communicate with Prompt Assistant backend.' },
			{ status: 500 }
		);
	}
}
