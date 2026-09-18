import { POST as canonicalPost } from '../auto-plan/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Legacy snake_case endpoint for auto-planning.
 * Delegates directly to the canonical kebab-case handler (/api/cam/auto-plan).
 */
export async function POST(request: Request): Promise<Response> {
	return canonicalPost(request);
}

