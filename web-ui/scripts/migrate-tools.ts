import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const tdCount = await prisma.toolDefinition.count();
    console.log(`Found ${tdCount} ToolDefinitions in DB.`);
    
    if (tdCount > 0) {
        console.log('Migrating ToolDefinitions to Tool...');
        const defs = await prisma.toolDefinition.findMany();
        
        let imported = 0;
        for (const def of defs) {
            try {
                // Check if tool already exists by name
                const existing = await prisma.tool.findFirst({ where: { name: def.name } });
                if (!existing) {
                    await prisma.tool.create({
                        data: {
                            name: def.name,
                            category: "Milling",
                            type: def.type,
                            description: `Imported from legacy ToolDefinition ${def.id}`,
                            manufacturer: def.manufacturer || "Generic",
                            isActive: true,
                            geometry: {
                                create: {
                                    diameter: def.diameter,
                                    fluteCount: def.flutes,
                                    fluteLength: def.stickout * 0.7, // approximation
                                    overallLength: def.stickout * 1.5,
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
