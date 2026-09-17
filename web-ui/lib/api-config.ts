/**
 * Shared API configuration and upstream proxy helper for Next.js BFF.
 */

export function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim() || process.env.AI_ENGINE_URL?.trim();
	return (value || 'http://127.0.0.1:8001/api/v1').replace(/\/$/, '');
}

export async function fetchWithTimeout(
	url: string,
	options: RequestInit = {},
	timeoutMs: number = 60000
): Promise<Response> {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);

	const apiKey = process.env.INTERNAL_API_KEY?.trim();
	const headers = new Headers(options.headers || {});
	if (apiKey && !headers.has('X-Api-Key')) {
		headers.set('X-Api-Key', apiKey);
	}

	try {
		const res = await fetch(url, {
			...options,
			headers,
			signal: controller.signal,
		});
		return res;
	} finally {
		clearTimeout(id);
	}
}
