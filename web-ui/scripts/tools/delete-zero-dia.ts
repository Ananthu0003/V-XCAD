import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const tools = await prisma.tool.findMany({ include: { geometry: true } });
    const zeroDia = tools.filter(t => !t.geometry || t.geometry.diameter === 0);
    console.log('Tools with 0mm diameter:', zeroDia.map(t => t.name).join(', '));
    
    // Delete them
    const ids = zeroDia.map(t => t.id);
    if (ids.length > 0) {
        await prisma.tool.deleteMany({
            where: { id: { in: ids } }
        });
        console.log(`Deleted ${ids.length} tools.`);
    }
}
main().finally(() => prisma.$disconnect());
