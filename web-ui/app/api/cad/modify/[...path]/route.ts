import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { aiEngineFetch } from '@/lib/aiEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
  const value = process.env.FASTAPI_URL?.trim() || 'http://127.0.0.1:8000/api/v1';
  return value.replace(/\/$/, '');
}

async function verifySessionOwnership(sessionId: string, userId: string): Promise<boolean> {
  if (!sessionId || sessionId === 'default_session') return true;
  try {
    const session = await prisma.cadSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, isShared: true },
    });
    if (!session) return true; // Transient session not yet written to DB
    if (session.userId === userId || session.isShared) return true;
    return false;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const userId = await requireSession();
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { path } = await params;
    const subpath = path.join('/');

    // Extract sessionId from known subpath structures:
    // e.g. topology/{session_id}, history/{session_id}, context/{session_id}, file/{session_id}/...
    let targetSessionId: string | null = null;
    if (path.length >= 2 && ['topology', 'history', 'context', 'file'].includes(path[0])) {
      targetSessionId = path[1];
    }

    if (targetSessionId) {
      const isAuthorized = await verifySessionOwnership(targetSessionId, userId);
      if (!isAuthorized) {
        return NextResponse.json(
          { error: { message: 'Forbidden. You do not have permission to access this CAD session.' } },
          { status: 403 }
        );
      }
    }

    const url = new URL(request.url);
    const queryString = url.search;

    const fastApiBase = getFastApiUrl();
    const targetUrl = fastApiBase.endsWith('/api/v1')
      ? `${fastApiBase}/cad/modify/${subpath}${queryString}`
      : `${fastApiBase}/api/v1/cad/modify/${subpath}${queryString}`;

    const response = await aiEngineFetch(targetUrl, {
      method: 'GET',
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } else {
      const blob = await response.blob();
      return new NextResponse(blob, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': response.headers.get('content-disposition') || 'inline',
        },
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: { message: err?.message || 'Manual CAD request failed' } },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const userId = await requireSession();
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { path } = await params;
    const subpath = path.join('/');
    const body = await request.json().catch(() => ({}));

    const targetSessionId = body?.session_id;
    if (targetSessionId && typeof targetSessionId === 'string') {
      const isAuthorized = await verifySessionOwnership(targetSessionId, userId);
      if (!isAuthorized) {
        return NextResponse.json(
          { error: { message: 'Forbidden. You do not have permission to modify this CAD session.' } },
          { status: 403 }
        );
      }
    }

    const fastApiBase = getFastApiUrl();
    const targetUrl = fastApiBase.endsWith('/api/v1')
      ? `${fastApiBase}/cad/modify/${subpath}`
      : `${fastApiBase}/api/v1/cad/modify/${subpath}`;

    const response = await aiEngineFetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: { message: err?.message || 'Manual CAD operation failed' } },
      { status: 500 }
    );
  }
}
