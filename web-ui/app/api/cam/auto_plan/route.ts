import { NextResponse } from 'next/server';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';
import { getSession } from '@/lib/auth';
import { validateBody, AutoPlanRequestSchema } from '@/lib/cam/validation';

export async function POST(request: Request): Promise<Response> {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();

		const validation = validateBody(AutoPlanRequestSchema, body);
		if (!validation.success) {
			return NextResponse.json({ error: validation.error }, { status: 400 });
		}

		const upstreamUrl = `${getFastApiUrl()}/cam/auto_plan`;

		const response = await fetchWithTimeout(upstreamUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}, 120000);

		const data = await response.json();
		return NextResponse.json(data, { status: response.status });
	} catch (error: any) {
		const isTimeout = error?.name === 'AbortError';
		return NextResponse.json(
			{
				error: {
					message: isTimeout
						? 'Auto planning timed out.'
						: (error?.message || 'Auto planning request failed.'),
				},
			},
			{ status: isTimeout ? 504 : 500 }
		);
	}
}
