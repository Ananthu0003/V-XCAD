import { NextResponse } from 'next/server';
import { cleanupExpiredSessions, requireAdmin } from '@/lib/auth';

/**
 * POST /api/auth/cleanup
 * Removes expired sessions from the database.
 * Admin only.
 */
export async function POST() {
  try {
    const adminId = await requireAdmin();
    if (!adminId) {
      return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
    }
    const deleted = await cleanupExpiredSessions();
    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    console.error('Session cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
