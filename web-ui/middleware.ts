import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface RateLimitRecord {
	count: number;
	resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

function cleanExpiredRateLimits(now: number) {
	if (rateLimitMap.size > 5000) {
		for (const [key, record] of rateLimitMap.entries()) {
			if (now > record.resetTime) {
				rateLimitMap.delete(key);
			}
		}
	}
}

export async function middleware(request: NextRequest) {
	try {
		const { pathname, search } = request.nextUrl;
		const authToken = request.cookies.get('auth_token')?.value;

		// 1. Rate Limiting for API routes
		if (pathname.startsWith('/api/')) {
			const isAuthRoute = pathname.startsWith('/api/auth/login') ||
				pathname.startsWith('/api/auth/register') ||
				pathname.startsWith('/api/auth/forgot-password');

			const isComputeRoute = pathname.startsWith('/api/generate') ||
				pathname.startsWith('/api/render') ||
				pathname.startsWith('/api/cam/');

			if (isAuthRoute || isComputeRoute) {
				const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anonymous';
				const key = `${isAuthRoute ? 'auth' : 'compute'}:${ip}`;
				const limit = isAuthRoute ? 10 : 30; // 10 req/min for auth, 30 req/min for compute
				const windowMs = 60 * 1000;
				const now = Date.now();

				cleanExpiredRateLimits(now);

				const record = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };
				if (now > record.resetTime) {
					record.count = 0;
					record.resetTime = now + windowMs;
				}

				record.count += 1;
				rateLimitMap.set(key, record);

				if (record.count > limit) {
					return new NextResponse(
						JSON.stringify({ error: 'Too many requests. Please try again later.' }),
						{
							status: 429,
							headers: {
								'Content-Type': 'application/json',
								'Retry-After': '60',
							},
						}
					);
				}
			}
		}

		// 2. Protect /workspace routes: redirect unauthenticated users to /login
		if (pathname.startsWith('/workspace')) {
			if (!authToken) {
				const loginUrl = new URL('/login', request.url);
				const redirectPath = pathname + (search || '');
				if (redirectPath !== '/workspace') {
					loginUrl.searchParams.set('redirect', redirectPath);
				}
				return NextResponse.redirect(loginUrl);
			}
		}

		// 3. Redirect already authenticated users away from login/register
		if (pathname === '/login' || pathname === '/register') {
			if (authToken) {
				return NextResponse.redirect(new URL('/workspace', request.url));
			}
		}

		return NextResponse.next();
	} catch (error) {
		console.error('Middleware execution error:', error);
		return NextResponse.next();
	}
}

export const config = {
	matcher: [
		'/workspace/:path*',
		'/login',
		'/register',
		'/api/:path*',
	],
};

