import { NextRequest, NextResponse } from 'next/server';
import { getToolById, updateTool, deleteTool, deactivateTool } from '@/lib/db/tools';
import { toolSchema } from '@/lib/validation/toolSchema';
import { Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // VEX-2A-003: Require authenticated session
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const tool = await getToolById(id);
    if (!tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
    }
    return NextResponse.json(tool);
  } catch (error) {
    console.error('Failed to fetch tool:', error);
    return NextResponse.json({ error: 'Failed to fetch tool' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // VEX-2A-003: Require authenticated session
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    
    const result = toolSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.format() }, 
        { status: 400 }
      );
    }

    const tool = await updateTool(id, result.data);
    return NextResponse.json(tool);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[]) || [];
        if (target.includes('name')) {
          return NextResponse.json({ error: 'A tool with this name already exists' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Unique constraint failed' }, { status: 409 });
      }
    }
    console.error('Failed to update tool:', error);
    return NextResponse.json({ error: 'Failed to update tool' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // VEX-2A-003: Require authenticated session
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const { id } = await params;
    // Soft delete / deactivate
    await deactivateTool(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete tool:', error);
    return NextResponse.json({ error: 'Failed to delete tool' }, { status: 500 });
  }
}
