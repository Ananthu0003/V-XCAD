import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { aiEngineFetch } from '@/lib/aiEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
  const value = process.env.FASTAPI_URL?.trim() || 'http://127.0.0.1:8000/api/v1';
  return value.replace(/\/$/, '');
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
