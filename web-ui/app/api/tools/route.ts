import { NextRequest, NextResponse } from 'next/server';
import { getTools, createTool } from '@/lib/db/tools';
import { toolSchema } from '@/lib/validation/toolSchema';
import { Prisma } from '@prisma/client';

export async function GET() {
  try {
    const tools = await getTools();
    return NextResponse.json(tools);
  } catch (error) {
    console.error('Failed to fetch tools:', error);
    return NextResponse.json({ error: 'Failed to fetch tools' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request body
    const result = toolSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.error.format() }, 
        { status: 400 }
      );
    }

    const tool = await createTool(result.data);
    return NextResponse.json(tool, { status: 201 });
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
    console.error('Failed to create tool:', error);
    return NextResponse.json({ error: 'Failed to create tool' }, { status: 500 });
  }
}
