import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
	const { pathname, search } = request.nextUrl;
	const authToken = request.cookies.get('auth_token')?.value;

	// Protect /workspace routes: redirect unauthenticated users to /login
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

	// Redirect already authenticated users away from login/register
	if (pathname === '/login' || pathname === '/register') {
		if (authToken) {
			return NextResponse.redirect(new URL('/workspace', request.url));
		}
	}

	return NextResponse.next();
}

export default middleware;

export const config = {
	matcher: ['/workspace/:path*', '/login', '/register'],
};
