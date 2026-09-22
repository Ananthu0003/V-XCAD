import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

/**
 * Finding 2 (P3) — CSP hardening: per-request nonce for script-src, replacing
 * 'unsafe-inline'. Uses the Next.js 16 Proxy file convention (the renamed
 * middleware.ts) since Proxy runs before rendering and can generate a fresh
 * nonce per request — see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
 *
 * Next.js automatically applies this nonce (via the 'nonce-{value}' token it
 * parses out of the Content-Security-Policy response header) to its own
 * framework scripts and hydration payload during server-side rendering, so
 * no changes to app/layout.tsx are required for that part.
 *
 * unsafe-eval: kept ONLY in development, where React requires it to
 * reconstruct server-side error stacks in the browser (documented Next.js
 * behavior, not specific to this app). It is empirically NOT needed in
 * production: @monaco-editor/react is a declared dependency but is not
 * imported anywhere in app/, components/, or lib/ (verified by source
 * search), and no other dependency in package.json is known to require eval.
 *
 * style-src intentionally keeps 'unsafe-inline' (not touched by this finding
 * — see the audit; a nonce/hash-based style CSP is a separate, riskier
 * change deferred until inline style usage across the app is audited).
 *
 * The /workspace auth-redirect check below is pre-existing and unrelated to
 * this finding; it is preserved as-is. The matcher was widened from
 * '/workspace/:path*' to run on (almost) all page routes so the CSP header
 * is set everywhere, while the auth check itself still only applies to
 * /workspace paths.
 */
export async function proxy(request: NextRequest) {
	if (request.nextUrl.pathname.startsWith('/workspace')) {
		const token = request.cookies.get('auth_token')?.value;

		if (!token) {
			return NextResponse.redirect(new URL('/login', request.url));
		}

		const payload = await verifyToken(token);
		if (!payload) {
			return NextResponse.redirect(new URL('/login', request.url));
		}
	}

	const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
	const isDev = process.env.NODE_ENV === 'development';

	const cspHeader = `
		default-src 'self';
		script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
		style-src 'self' 'unsafe-inline';
		img-src 'self' blob: data:;
		font-src 'self';
		connect-src 'self';
		frame-ancestors 'none';
		base-uri 'self';
		form-action 'self';
	`;
	const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, ' ').trim();

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set('x-nonce', nonce);
	requestHeaders.set('Content-Security-Policy', contentSecurityPolicyHeaderValue);

	const response = NextResponse.next({
		request: {
			headers: requestHeaders,
		},
	});
	response.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue);

	return response;
}

export const config = {
	matcher: [
		{
			source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
			missing: [
				{ type: 'header', key: 'next-router-prefetch' },
				{ type: 'header', key: 'purpose', value: 'prefetch' },
			],
		},
	],
};
