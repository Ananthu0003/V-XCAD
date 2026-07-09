import { NextRequest, NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";

export async function GET() {
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
