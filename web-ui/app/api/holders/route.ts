import { NextRequest, NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";
import { requireSession } from '@/lib/auth';

export async function GET() {
  // VEX-2A-003: Require authenticated session
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const holders = await prisma.holder.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(holders);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch holders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // VEX-2A-003: Require authenticated session
  if (!(await requireSession())) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const body = await request.json();
    
    const holder = await prisma.holder.create({
      data: {
        name: body.name,
        type: body.type,
        gaugeLength: body.gaugeLength,
        diameter: body.diameter,
        shankSize: body.shankSize,
        taperType: body.taperType,
        manufacturer: body.manufacturer,
        description: body.description,
      }
    });
    
    return NextResponse.json(holder, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create holder' }, { status: 500 });
  }
}
