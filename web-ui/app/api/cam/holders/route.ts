import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const holders = await prisma.holder.findMany({
            orderBy: { name: 'asc' },
        });
        return NextResponse.json({ holders });
    } catch (error) {
        console.error('Error fetching holders:', error);
        return NextResponse.json({ error: 'Failed to fetch holders' }, { status: 500 });
    }
}

