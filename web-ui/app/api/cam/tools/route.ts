import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const material_code = searchParams.get('material');
    const coating_code = searchParams.get('coating');
    const minDiameter = searchParams.get('minDiameter');
    const maxDiameter = searchParams.get('maxDiameter');
    const flutes = searchParams.get('flutes');

    const filters: any = { isActive: true };

    if (type) filters.type = type;
    
    const geometryFilters: any = {};
    if (flutes) geometryFilters.fluteCount = parseInt(flutes);
    if (minDiameter || maxDiameter) {
        geometryFilters.diameter = {};
        if (minDiameter) geometryFilters.diameter.gte = parseFloat(minDiameter);
        if (maxDiameter) geometryFilters.diameter.lte = parseFloat(maxDiameter);
    }
    
    if (Object.keys(geometryFilters).length > 0) {
        filters.geometry = geometryFilters;
    }

    try {
        let tools = await prisma.tool.findMany({
            where: filters,
            include: {
                geometry: true,
                offsets: true,
                assembly: {
                    include: {
                        holder: true
                    }
                },
                cuttingData: true,
                compatibility: true,
            },
        });
        
        // Since material & coating filters are now in JSON arrays or part of the name/description 
        // depending on how they were imported, we do manual post-filtering if needed.
        if (material_code) {
            tools = tools.filter(t => {
                const materials = t.compatibility?.compatibleMaterialsJson ? JSON.parse(t.compatibility.compatibleMaterialsJson) : [];
                return materials.includes(material_code);
            });
        }
        
        if (coating_code) {
             // For the new schema, coating is often stored in the name, description, or we skip strict coating filtering.
             // We'll leave it out of strict DB query for now to avoid breaking the tool list.
        }
        
        // Sort by diameter and then type
        tools.sort((a, b) => {
            const diaA = a.geometry?.diameter || 0;
            const diaB = b.geometry?.diameter || 0;
            if (diaA !== diaB) return diaA - diaB;
            return a.type.localeCompare(b.type);
        });

        return NextResponse.json({ tools });
    } catch (error) {
        console.error('Error fetching tools:', error);
        return NextResponse.json({ error: 'Failed to fetch tools' }, { status: 500 });
    }
}

