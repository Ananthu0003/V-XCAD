import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { featureType, workpieceMaterial, diameterHint } = body;

        // Base mapping of features to required tool types
        let requiredToolType = 'flat_end_mill';
        if (featureType === 'through_hole' || featureType === 'blind_hole') {
            requiredToolType = 'drill';
        } else if (featureType === 'chamfer') {
            requiredToolType = 'chamfer_mill';
        } else if (featureType === 'facing') {
            requiredToolType = 'face_mill';
        }

        const toolFilters: any = {
            type: requiredToolType,
            isActive: true
        };

        // Find tools of the required type
        let tools = await prisma.tool.findMany({
            where: toolFilters,
            include: {
                geometry: true,
                offsets: true,
                assembly: {
                    include: { holder: true }
                },
                cuttingData: true,
                compatibility: true,
            }
        });

        // Filter tools that are compatible with the workpiece material, if specified
        if (workpieceMaterial) {
            const materialCompatibleTools = tools.filter(t => {
                const materials = t.compatibility?.compatibleMaterialsJson 
                    ? JSON.parse(t.compatibility.compatibleMaterialsJson) 
                    : [];
                return materials.includes(workpieceMaterial) || materials.length === 0;
            });
            // If we have some that match the material, use them. Otherwise fallback to all tools of that type.
            if (materialCompatibleTools.length > 0) {
                tools = materialCompatibleTools;
            }
        }

        // Sort by diameter ascending
        tools.sort((a, b) => (a.geometry?.diameter || 0) - (b.geometry?.diameter || 0));

        let recommendedTool = tools[0]; // fallback to smallest

        if (diameterHint) {
            // Find a tool close to the diameter hint but smaller or equal to it (to fit in a pocket)
            const fittingTools = tools.filter(t => (t.geometry?.diameter || 0) <= diameterHint);
            if (fittingTools.length > 0) {
                // Get the largest one that fits
                recommendedTool = fittingTools[fittingTools.length - 1];
            }
        }

        if (!recommendedTool) {
            return NextResponse.json({ error: 'No compatible tool found' }, { status: 404 });
        }

        // Use the tool's own cutting data if available, otherwise calculate generic fallbacks
        let feedsAndSpeeds = null;
        if (recommendedTool.cuttingData) {
            feedsAndSpeeds = {
                spindleSpeed: recommendedTool.cuttingData.spindleRpm,
                feedRate: recommendedTool.cuttingData.feedRate,
                plungeRate: recommendedTool.cuttingData.plungeRate,
                coolant: recommendedTool.cuttingData.coolant || 'flood'
            };
        } else {
            // generic fallback
            const rpm = 5000;
            const flutes = recommendedTool.geometry?.fluteCount || 2;
            const feedRate = Math.round(rpm * flutes * 0.05);
            feedsAndSpeeds = {
                spindleSpeed: rpm,
                feedRate: feedRate,
                plungeRate: Math.round(feedRate * 0.5),
                coolant: 'flood'
            };
        }

        return NextResponse.json({
            tool: recommendedTool,
            cuttingData: recommendedTool.cuttingData,
            feedsAndSpeeds
        });

    } catch (error) {
        console.error('Recommendation Engine Error:', error);
        return NextResponse.json({ error: 'Failed to generate recommendation' }, { status: 500 });
    }
}
