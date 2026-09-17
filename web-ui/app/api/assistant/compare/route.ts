import { NextResponse } from 'next/server';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
	const userId = await requireSession();
	if (!userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to use the assistant.' } },
			{ status: 401 }
		);
	}

	try {
		const body = await request.json();
		const fastApiUrl = `${getFastApiUrl()}/assistant/compare-and-prompt`;

		const response = await fetchWithTimeout(fastApiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		}, 60000);

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
