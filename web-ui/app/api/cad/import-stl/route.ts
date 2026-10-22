import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveOutputsDir } from '@/lib/outputsDir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_STL_SIZE = 50 * 1024 * 1024; // 50MB

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
        { error: { message: 'No STL file provided in request.' } },
        { status: 400 }
      );
    }

    const lowerName = file.name.toLowerCase();
    const isStep = lowerName.endsWith('.step') || lowerName.endsWith('.stp');
    const isStl = lowerName.endsWith('.stl');

    if (!isStep && !isStl) {
      return NextResponse.json(
        { error: { message: 'Only .step, .stp, and .stl files are supported for 3D model import.' } },
        { status: 400 }
      );
    }

    if (file.size > MAX_STL_SIZE) {
      return NextResponse.json(
        { error: { message: 'File exceeds maximum 50MB size limit.' } },
        { status: 400 }
      );
    }

    // Generate or sanitize session ID (alphanumeric + hyphen only to prevent directory traversal)
    const rawSessionId = formData.get('session_id');
    const sessionId = (typeof rawSessionId === 'string' && /^[a-zA-Z0-9-]+$/.test(rawSessionId))
      ? rawSessionId
      : `${isStep ? 'step' : 'stl'}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

    const fileName = file.name;
    const fileExt = isStep ? 'step' : 'stl';
    const filenameOnDisk = `cad_${sessionId}.${fileExt}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const outputsDir = resolveOutputsDir();

    if (outputsDir) {
      await writeFile(join(outputsDir, filenameOnDisk), buffer);
    } else {
      // Host-side local development fallback
      const devDirs = [
        join(process.cwd(), '../ai-engine/outputs'),
        join(process.cwd(), '../outputs'),
        join(process.cwd(), 'outputs'),
      ];
      for (const d of devDirs) {
        try {
          if (!fs.existsSync(d)) {
            fs.mkdirSync(d, { recursive: true });
          }
          await writeFile(join(d, filenameOnDisk), buffer);
        } catch {
          // ignore
        }
      }
    }

    const fileUrl = `/api/outputs/${filenameOnDisk}`;
    const stepUrl = isStep ? fileUrl : undefined;
    const stlUrl = isStl ? fileUrl : `/api/outputs/cad_${sessionId}.stl`;

    const existingSession = await prisma.cadSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (existingSession && existingSession.userId && existingSession.userId !== authSession.userId) {
      return NextResponse.json(
        { error: { message: 'Forbidden. You do not own this session.' } },
        { status: 403 }
      );
    }

    const cadSession = await prisma.cadSession.upsert({
      where: { id: sessionId },
      update: {
        prompt: `Imported 3D Model: ${fileName}`,
        fileName: fileName,
        stlUrl: stlUrl,
        stepUrl: stepUrl,
      },
      create: {
        id: sessionId,
        prompt: `Imported 3D Model: ${fileName}`,
        fileName: fileName,
        stlUrl: stlUrl,
        stepUrl: stepUrl,
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
    console.error('Error importing STL:', error);
    return NextResponse.json(
      { error: { message: error?.message || 'Failed to import STL file' } },
      { status: 500 }
    );
  }
}
