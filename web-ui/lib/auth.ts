import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET;
if (!secretKey) {
  throw new Error('JWT_SECRET environment variable is required.');
}
const JWT_SECRET = new TextEncoder().encode(secretKey);

export interface UserSession {
  userId: string;
  email: string;
  tokenVersion: number;
  role?: string;
}

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

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  return await verifyToken(token);
}

/**
 * VEX-2A-003: Require an authenticated session with a valid user in the database.
 * VEX-2A-011: Also validates tokenVersion to invalidate old tokens after password reset.
 * Returns the userId if valid, or null if authentication fails.
 * Callers should return 401 when this returns null.
 */
export async function requireSession(): Promise<string | null> {
  const session = await getSession();
  if (!session?.userId) return null;

  const { prisma } = await import('@/lib/prisma');
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, tokenVersion: true },
  });
  if (!user) return null;

  // VEX-2A-011: Invalidate tokens issued before a password reset.
  if (user.tokenVersion !== session.tokenVersion) return null;

  return session.userId;
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
    select: { isAdmin: true, role: true },
  });
  if (!user?.isAdmin && user?.role !== 'admin') return null;

  return userId;
}

/**
 * Delete an auth session by its JWT token.
 * Used by the logout endpoint to invalidate the session server-side.
 */
export async function deleteSession(token: string): Promise<void> {
  const { prisma } = await import('@/lib/prisma');
  await prisma.authSession.deleteMany({ where: { token } });
}

/**
 * Remove all expired auth sessions from the database.
 * Returns the number of deleted sessions.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const { prisma } = await import('@/lib/prisma');
  const result = await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

