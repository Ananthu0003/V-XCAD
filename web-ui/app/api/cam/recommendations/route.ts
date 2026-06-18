import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

        // Fetch cutting data for this workpiece material to find the optimal tool material + coating combination
        const cuttingData = await prisma.cuttingData.findMany({
            where: {
                workpiece_material: workpieceMaterial,
            },
            include: {
                tool_material: true,
                coating: true,
            },
            orderBy: {
                surface_speed: 'desc' // Prefer higher surface speed (better performance)
            }
        });

        const optimalData = cuttingData.length > 0 ? cuttingData[0] : null;

        const toolFilters: any = {
            type: requiredToolType,
        };

        if (optimalData) {
            toolFilters.material_id = optimalData.tool_material_id;
            if (optimalData.coating_id) {
                toolFilters.coating_id = optimalData.coating_id;
            }
        }

        // Try to match the exact tool type and material
        let tools = await prisma.toolDefinition.findMany({
            where: toolFilters,
            include: {
                material: true,
                coating: true,
                holder: true,
            },
            orderBy: { diameter: 'asc' }
        });

        // Fallback: If no tool with that material/coating exists, just get the tool type
        if (tools.length === 0) {
            tools = await prisma.toolDefinition.findMany({
                where: { type: requiredToolType },
                include: {
                    material: true,
                    coating: true,
                    holder: true,
                },
                orderBy: { diameter: 'asc' }
            });
        }

        let recommendedTool = tools[0]; // fallback to smallest

        if (diameterHint) {
            // Find a tool close to the diameter hint but smaller or equal to it (to fit in a pocket)
            const fittingTools = tools.filter(t => t.diameter <= diameterHint);
            if (fittingTools.length > 0) {
                // Get the largest one that fits
                recommendedTool = fittingTools[fittingTools.length - 1];
            }
        }

        if (!recommendedTool) {
            return NextResponse.json({ error: 'No compatible tool found' }, { status: 404 });
        }

        // Calculate Speeds & Feeds if we have cutting data
        let feedsAndSpeeds = null;
        if (optimalData) {
            // Standard formulas:
            // RPM = (Surface Speed * 1000) / (PI * Diameter)
            // Feed = RPM * Flutes * Feed per tooth
            
            const rpm = Math.round((optimalData.surface_speed * 1000) / (Math.PI * recommendedTool.diameter));
            const feedRate = Math.round(rpm * recommendedTool.flutes * optimalData.feed_per_tooth);
            const plungeRate = Math.round(feedRate * optimalData.plunge_multiplier);

            feedsAndSpeeds = {
                spindleSpeed: rpm,
                feedRate: feedRate,
                plungeRate: plungeRate,
                coolant: 'flood'
            };
        }

        return NextResponse.json({
            tool: recommendedTool,
            cuttingData: optimalData,
            feedsAndSpeeds
        });

    } catch (error) {
        console.error('Recommendation Engine Error:', error);
        return NextResponse.json({ error: 'Failed to generate recommendation' }, { status: 500 });
    }
}
