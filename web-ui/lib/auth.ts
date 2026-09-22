import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// Fail fast: a missing JWT_SECRET must never silently fall back to a
// publicly-known signing key (token forgery vulnerability).
if (!process.env.JWT_SECRET) {
	throw new Error(
		'JWT_SECRET environment variable is required. Set it in your .env file ' +
		'(generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))").'
	);
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function signToken(payload: { userId: string; email: string; tokenVersion: number }) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; email: string; tokenVersion: number };
  } catch {
    return null;
  }
}

/**
 * Signature-only session read: verifies the JWT (signature + expiry) and
 * NOTHING else. It does not touch the database, so it does not know whether the
 * account still exists or whether the token was invalidated by a tokenVersion
 * change.
 *
 * Use ONLY for database-independent, non-security decisions (e.g. choosing a
 * "Log in" vs "Open workspace" button on the landing page). Never use it to
 * gate data access or side effects — use getSession()/requireSession().
 */
export async function getUnverifiedSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  return await verifyToken(token);
}

/**
 * Authoritative session resolver.
 *
 * VEX-2A-011 / P2 (tokenVersion): a JWT is only accepted when its signature is
 * valid AND the user still exists AND the token's tokenVersion equals the
 * user's current tokenVersion. Tokens issued before an admin-approved password
 * reset (which increments tokenVersion) are therefore rejected by every caller.
 * Tokens without a tokenVersion claim (legacy) never match and are rejected.
 *
 * Fails closed: returns null for a missing/invalid token, an unknown user, or a
 * tokenVersion mismatch. A database error propagates to the caller instead of
 * being treated as "authenticated".
 */
export async function getSession() {
  const claims = await getUnverifiedSession();
  if (!claims?.userId) return null;

  // Dynamic import to avoid circular deps and keep this file lightweight.
  const { prisma } = await import('@/lib/prisma');
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, tokenVersion: true },
  });
  if (!user) return null;
  if (user.tokenVersion !== claims.tokenVersion) return null;

  return claims;
}

/**
 * VEX-2A-003: Require an authenticated session with a valid user in the database.
 * VEX-2A-011: Validates tokenVersion (via getSession) to invalidate old tokens
 * after password reset.
 * Returns the userId if valid, or null if authentication fails.
 * Callers should return 401 when this returns null.
 */
export async function requireSession(): Promise<string | null> {
  const session = await getSession();
  return session?.userId ?? null;
}

/**
 * VEX-2A-011: Require an authenticated admin session.
 * Returns the userId if the user is an admin, or null otherwise.
 * Callers should return 403 when this returns null.
 */
export async function requireAdmin(): Promise<string | null> {
  const userId = await requireSession();
  if (!userId) return null;

  const { prisma } = await import('@/lib/prisma');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) return null;

  return userId;
}
