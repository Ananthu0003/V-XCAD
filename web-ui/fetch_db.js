const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
    const session = await prisma.cadSession.findFirst({
        where: { pythonScript: { not: null } },
        orderBy: { updatedAt: 'desc' }
    });
    if (session) {
        fs.writeFileSync('latest_script.py', session.pythonScript);
        console.log(`Wrote script ${session.id}`);
    } else {
        console.log("No sessions found");
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
