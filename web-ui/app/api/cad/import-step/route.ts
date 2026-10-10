import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveOutputsDir } from '@/lib/outputsDir';
import { aiEngineFetch } from '@/lib/aiEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_STEP_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const authSession = await getSession();
    if (!authSession?.userId) {
      return NextResponse.json(
        { error: { message: 'Authentication required to persist imported model.', hint: 'Log in to save imported sessions.' } },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: { message: 'No STEP file provided in request.' } },
        { status: 400 }
      );
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.step') && !lowerName.endsWith('.stp')) {
      return NextResponse.json(
        { error: { message: 'Only .step and .stp files are supported for CAD solid model import.' } },
        { status: 400 }
      );
    }

    if (file.size > MAX_STEP_SIZE) {
      return NextResponse.json(
        { error: { message: 'File exceeds maximum 50MB size limit for STEP solid models.' } },
        { status: 400 }
      );
    }

    // Generate or sanitize session ID (alphanumeric + hyphen/underscore only)
    const rawSessionId = formData.get('session_id');
    const sessionId = (typeof rawSessionId === 'string' && /^[a-zA-Z0-9_-]+$/.test(rawSessionId))
      ? rawSessionId
      : `step-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

    const fileName = file.name;
    const filenameOnDisk = `cad_${sessionId}.step`;
    const outputsDir = resolveOutputsDir();

    if (outputsDir) {
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(join(outputsDir, filenameOnDisk), buffer);
    }

    const stepUrl = `/api/outputs/${filenameOnDisk}`;
    let stlUrl: string | null = null;

    // Trigger AI engine to initialize the B-Rep session and tessellate STL for viewport
    try {
      const fastApiBase = process.env.FASTAPI_URL?.trim() || 'http://127.0.0.1:8000/api/v1';
      const cleanBase = fastApiBase.replace(/\/$/, '');
      const targetUrl = cleanBase.endsWith('/api/v1')
        ? `${cleanBase}/cad/modify/import-step`
        : `${cleanBase}/api/v1/cad/modify/import-step`;

      const aiRes = await aiEngineFetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          filename: fileName,
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData.stl_url) {
          stlUrl = aiData.stl_url;
        }
      }
    } catch (engineErr) {
      console.warn('AI engine B-Rep preprocessing skipped or failed:', engineErr);
    }

    const cadSession = await prisma.cadSession.create({
      data: {
        id: sessionId,
        prompt: `Imported 3D Model: ${fileName}`,
        fileName: fileName,
        stepUrl: stepUrl,
        stlUrl: stlUrl || `/api/outputs/cad_${sessionId}.stl`,
        userId: authSession.userId,
        parameters: {},
      },
    });

    return NextResponse.json({
      success: true,
      sessionId: cadSession.id,
      stepUrl: cadSession.stepUrl,
      stlUrl: cadSession.stlUrl,
      fileName: fileName,
    });
  } catch (error: any) {
    console.error('Error importing STEP:', error);
    return NextResponse.json(
      { error: { message: error?.message || 'Failed to import STEP file' } },
      { status: 500 }
    );
  }
}
