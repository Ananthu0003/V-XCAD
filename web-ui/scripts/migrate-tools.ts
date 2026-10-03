import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const tdCount = await prisma.toolDefinition.count();
    console.log(`Found ${tdCount} ToolDefinitions in DB.`);
    
    if (tdCount > 0) {
        console.log('Migrating ToolDefinitions to Tool...');
        const defs = await prisma.toolDefinition.findMany({
            include: { material: true, coating: true, holder: true }
        });
        
        let imported = 0;
        for (const def of defs) {
            try {
                // Determine category
                const typeNormalized = def.type === 'ball_nose' ? 'ball_end_mill' : def.type;
                let category = 'milling';
                if (['drill', 'center_drill', 'spot_drill', 'tap', 'reamer'].includes(typeNormalized)) {
                    category = 'drilling';
                } else if (['turning_tool', 'boring_bar', 'threading_tool', 'cut_off_tool', 'knurling_tool'].includes(typeNormalized)) {
                    category = 'turning';
                }

                // Geometry extras
                const geomData: any = {
                    diameter: def.diameter,
                    fluteCount: def.flutes,
                    fluteLength: Math.round(def.stickout * 0.7 * 10) / 10,
                    overallLength: Math.round(def.stickout * 1.5 * 10) / 10,
                    shankDiameter: def.diameter,
                };

                if (typeNormalized === 'ball_end_mill') {
                    geomData.ballRadius = Math.round((def.diameter / 2) * 100) / 100;
                } else if (typeNormalized === 'chamfer_mill') {
                    geomData.includedAngle = 90;
                } else if (['drill', 'spot_drill', 'center_drill'].includes(typeNormalized)) {
                    geomData.pointAngle = 118;
                }

                // Cutting data calculations
                const rpm = Math.min(24000, Math.max(1000, Math.round(30000 / Math.max(1, def.diameter))));
                const feed = Math.min(5000, Math.max(100, Math.round(rpm * 0.05 * (def.flutes || 2))));

                const existing = await prisma.tool.findFirst({ where: { name: def.name } });
                if (!existing) {
                    await prisma.tool.create({
                        data: {
                            name: def.name,
                            category: category,
                            type: typeNormalized,
                            description: `${def.name} - ${def.material?.material_name || 'Standard'} / ${def.coating?.coating_name || 'Standard'}`,
                            manufacturer: def.manufacturer || "Generic",
                            unit: "mm",
                            isActive: true,
                            geometry: {
                                create: geomData
                            },
                            offsets: {
                                create: {
                                    lengthOffset: 1,
                                    diameterOffset: 1,
                                    compensationType: "computer"
                                }
                            },
                            assembly: {
                                create: {
                                    stickoutLength: def.stickout || (def.diameter * 3.5),
                                }
                            },
                            cuttingData: {
                                create: {
                                    spindleRpm: rpm,
                                    feedRate: feed,
                                    plungeRate: Math.round(feed * 0.3),
                                    retractRate: Math.round(feed * 0.6),
                                    coolant: "flood",
                                    stepdown: Math.round((def.diameter * 0.5) * 10) / 10,
                                    stepover: Math.round((def.diameter * 0.4) * 10) / 10,
                                }
                            },
                            compatibility: {
                                create: {
                                    compatibleMaterialsJson: JSON.stringify(def.material?.recommended_workpiece_materials || ['aluminum_6061', 'mild_steel']),
                                    compatibleMachinesJson: JSON.stringify(['3-Axis CNC Mill', '5-Axis CNC Mill', 'CNC Lathe']),
                                }
                            }
                        }
                    });
                    imported++;
                }
            } catch (e: any) {
                console.error(`Failed to migrate ${def.name}:`, e?.message || String(e));
            }
        }
        console.log(`Successfully migrated ${imported} tools!`);
    } else {
        console.log('No ToolDefinitions to migrate. Maybe we need to run seed.ts?');
    }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
