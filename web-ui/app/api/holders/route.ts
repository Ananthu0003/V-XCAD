import { NextRequest, NextResponse } from 'next/server';
import { prisma } from "@/lib/prisma";
import { requireSession, requireAdmin } from '@/lib/auth';
import { holderSchema } from '@/lib/validation/holderSchema';

export async function GET() {
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
  const userId = await requireSession();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    
    const parsed = holderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const holder = await prisma.holder.create({
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        gaugeLength: parsed.data.gaugeLength,
        diameter: parsed.data.diameter,
        shankSize: parsed.data.shankSize ?? null,
        taperType: parsed.data.taperType ?? null,
        manufacturer: parsed.data.manufacturer ?? null,
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive,
      }
    });
    
    return NextResponse.json(holder, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create holder' }, { status: 500 });
  }
}
