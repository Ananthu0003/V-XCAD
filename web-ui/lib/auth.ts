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

export async function signToken(payload: { userId: string; email: string }) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; email: string };
  } catch (error) {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  return await verifyToken(token);
}
