import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession, getSession } from '@/lib/auth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    if (token) {
      await deleteSession(token);

      // Invalidate JWT by incrementing tokenVersion so existing tokens fail verification
      const session = await getSession();
      if (session?.userId) {
        const { prisma } = await import('@/lib/prisma');
        await prisma.user.update({
          where: { id: session.userId },
          data: { tokenVersion: { increment: 1 } },
        });
      }
    }

    cookieStore.delete({ name: 'auth_token', path: '/' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
