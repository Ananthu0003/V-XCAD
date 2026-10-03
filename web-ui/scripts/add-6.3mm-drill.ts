import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('Adding 6.3mm Long Reach Twist Drill...');
    
    // Check if it already exists
    const existing = await prisma.tool.findFirst({
        where: { name: '6.3mm Long Reach Twist Drill' }
    });
    
    if (existing) {
        console.log('Tool already exists!');
        return;
    }
    
    const tool = await prisma.tool.create({
        data: {
            name: '6.3mm Long Reach Twist Drill',
            category: 'Hole Making',
            type: 'drill',
            description: 'Custom drill for deep 6.3mm holes.',
            manufacturer: 'CustomTooling',
            isActive: true,
            geometry: {
                create: {
                    diameter: 6.3,
                    fluteCount: 2,
                    fluteLength: 55.0,
                    overallLength: 80.0
                }
            },
            assembly: {
                create: {
                    stickoutLength: 60.0
                }
            }
        }
    });
    console.log(`Created tool: ${tool.name} with ID: ${tool.id}`);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
