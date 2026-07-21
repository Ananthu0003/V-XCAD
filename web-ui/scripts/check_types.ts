import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const tools = await prisma.tool.findMany();
    for (const t of tools) {
        console.log(t.name + ' - ' + t.type);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
