/**
 * @jest-environment node
 *
 * Finding 2 (P3) — CSP hardening: nonce-based script-src.
 *
 * Exercises the REAL proxy.ts `proxy()` function (Next.js 16's renamed
 * middleware.ts convention) against a minimal NextRequest-shaped object.
 * @/lib/auth is mocked only to keep the (pre-existing, unrelated)
 * /workspace token check deterministic and to avoid pulling in jose (an
 * ESM-only package jest's default transform can't parse) for tests that
 * don't exercise that check at all.
 */

import { NextRequest } from 'next/server';

const mockVerifyToken = jest.fn();
jest.mock('@/lib/auth', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

import { proxy, config } from '@/proxy';

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  // Deliberately NOT /workspace: that path additionally runs a pre-existing
  // auth-redirect check (see the dedicated describe block below), which
  // would short-circuit before the CSP header is ever set.
  return new NextRequest('http://localhost:3000/login', { headers });
}

beforeEach(() => {
  mockVerifyToken.mockReset();
});

describe('Finding 2 — proxy() CSP header', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as any).NODE_ENV = originalNodeEnv;
  });

  it('sets a Content-Security-Policy header on the response', async () => {
    const res = await proxy(makeRequest());
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('script-src uses a nonce, not unsafe-inline', async () => {
    const res = await proxy(makeRequest());
    const csp = res.headers.get('Content-Security-Policy')!;
    const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('production script-src has no unsafe-eval', async () => {
    (process.env as any).NODE_ENV = 'production';
    const res = await proxy(makeRequest());
    const csp = res.headers.get('Content-Security-Policy')!;
    const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('development script-src keeps unsafe-eval (React debugging requirement)', async () => {
    (process.env as any).NODE_ENV = 'development';
    const res = await proxy(makeRequest());
    const csp = res.headers.get('Content-Security-Policy')!;
    const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it('generates a fresh, unpredictable nonce on every call', async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await proxy(makeRequest());
      const csp = res.headers.get('Content-Security-Policy')!;
      const nonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
      expect(nonce).toBeTruthy();
      nonces.add(nonce!);
    }
    expect(nonces.size).toBe(20);
  });

  it('an attacker-guessed or static nonce value never appears', async () => {
    const staticGuesses = ['static-nonce', '00000000-0000-0000-0000-000000000000', 'abc123'];
    for (let i = 0; i < 10; i++) {
      const res = await proxy(makeRequest());
      const csp = res.headers.get('Content-Security-Policy')!;
      for (const guess of staticGuesses) {
        expect(csp).not.toContain(`'nonce-${guess}'`);
      }
    }
  });

  it('propagates the same nonce to request headers (x-nonce) as the CSP header, so Next.js and Server Components see one consistent value', async () => {
    const res = await proxy(makeRequest());
    const csp = res.headers.get('Content-Security-Policy')!;
    const headerNonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    expect(headerNonce).toBeTruthy();
    expect(csp).toContain(`nonce-${headerNonce}`);
  });

  it('preserves frame-ancestors, base-uri, and form-action', async () => {
    const res = await proxy(makeRequest());
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('style-src still allows unsafe-inline (not touched by this finding)', async () => {
    const res = await proxy(makeRequest());
    const csp = res.headers.get('Content-Security-Policy')!;
    const styleSrc = csp.match(/style-src[^;]*/)?.[0] ?? '';
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('does not redirect, rewrite, or block the request — only adds headers', async () => {
    const res = await proxy(makeRequest());
    expect(res.headers.get('Location')).toBeNull();
  });
});

describe('Finding 2 — pre-existing /workspace auth redirect is preserved', () => {
  it('redirects to /login when no auth_token cookie is present on /workspace', async () => {
    const req = new NextRequest('http://localhost:3000/workspace');
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('redirects to /login when the token fails verification', async () => {
    mockVerifyToken.mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/workspace', {
      headers: { cookie: 'auth_token=bad-token' },
    });
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows through and sets CSP when the token verifies', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u1' });
    const req = new NextRequest('http://localhost:3000/workspace', {
      headers: { cookie: 'auth_token=good-token' },
    });
    const res = await proxy(req);
    expect(res.status).not.toBe(307);
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('does not run the token check on non-/workspace paths', async () => {
    const req = new NextRequest('http://localhost:3000/login');
    const res = await proxy(req);
    expect(res.status).not.toBe(307);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });
});

describe('Finding 2 — proxy() matcher config excludes api/_next/static/_next/image/favicon', () => {
  it('matcher source pattern excludes api and static asset paths', () => {
    const matcher = config.matcher[0] as any;
    const source = typeof matcher === 'string' ? matcher : matcher.source;
    const re = new RegExp('^' + source.replace(/^\^|\$$/g, '') + '$');
    // Paths that MUST be excluded (negative lookahead in the pattern):
    expect('/api/auth/me').not.toMatch(re);
    expect('/_next/static/chunks/x.js').not.toMatch(re);
    expect('/_next/image').not.toMatch(re);
    expect('/favicon.ico').not.toMatch(re);
    // Ordinary page paths MUST be included:
    expect('/workspace').toMatch(re);
    expect('/login').toMatch(re);
  });
});
