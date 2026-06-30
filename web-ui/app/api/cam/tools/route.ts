import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const material_code = searchParams.get('material');
    const coating_code = searchParams.get('coating');
    const minDiameter = searchParams.get('minDiameter');
    const maxDiameter = searchParams.get('maxDiameter');
    const flutes = searchParams.get('flutes');

    const filters: any = {};

    if (type) filters.type = type;
    if (material_code) filters.material = { material_code };
    if (coating_code) filters.coating = { coating_code };
    if (flutes) filters.flutes = parseInt(flutes);
    if (minDiameter || maxDiameter) {
        filters.diameter = {};
        if (minDiameter) filters.diameter.gte = parseFloat(minDiameter);
        if (maxDiameter) filters.diameter.lte = parseFloat(maxDiameter);
    }

    try {
        const tools = await prisma.toolDefinition.findMany({
            where: filters,
            include: {
                material: true,
                coating: true,
                holder: true,
            },
            orderBy: [
                { diameter: 'asc' },
                { type: 'asc' }
            ]
        });

        return NextResponse.json({ tools });
    } catch (error) {
        console.error('Error fetching tools:', error);
        return NextResponse.json({ error: 'Failed to fetch tools' }, { status: 500 });
    }
}
