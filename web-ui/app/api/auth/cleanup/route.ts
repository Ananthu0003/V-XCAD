import { NextResponse } from 'next/server';
import { cleanupExpiredSessions, requireAdmin } from '@/lib/auth';

/**
 * POST /api/auth/cleanup
 * Removes expired sessions from the database.
 * Admin only.
 */
export async function POST() {
  try {
    await requireAdmin();
    const deleted = await cleanupExpiredSessions();
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Session cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
