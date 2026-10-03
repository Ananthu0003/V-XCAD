import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { aiEngineFetch } from '@/lib/aiEngine';
import { RATE_LIMITS, enforce, rateLimitedResponse } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	return (value || 'http://127.0.0.1:8001/api/v1').replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	// VEX-006: Require authenticated session
	const authSession = await getSession();
	if (!authSession?.userId) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to use the assistant.' } },
			{ status: 401 }
		);
	}
	const userExists = await prisma.user.findUnique({ where: { id: authSession.userId } });
	if (!userExists) {
		return NextResponse.json(
			{ error: { message: 'Authentication required.', hint: 'Log in to use the assistant.' } },
			{ status: 401 }
		);
	}

	// Abuse control: LLM calls cost money. Per-user attempt limit (keyed by authenticated identity).
	const assistantLimited = await enforce([[RATE_LIMITS.assistant, authSession.userId]]);
	if (assistantLimited) return rateLimitedResponse(assistantLimited, 'nested');

	try {
		const body = await request.json();
		const fastApiUrl = `${getFastApiUrl()}/assistant/compare-and-prompt`;

		const response = await aiEngineFetch(fastApiUrl, {
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
