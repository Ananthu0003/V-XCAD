import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const tools = await prisma.tool.findMany();
    let updated = 0;

    for (const t of tools) {
        let newType = t.type;
        const name = t.name.toLowerCase();

        if (name.includes('t-slot') || name.includes('keyseat')) {
            newType = 't_slot_cutter';
        } else if (name.includes('tap') && !name.includes('tape')) {
            newType = 'tap';
        } else if (name.includes('thread mill') || name.includes('threading')) {
            newType = 'thread_mill';
        } else if (name.includes('slitting saw')) {
            newType = 'custom_profile_tool';
        } else if (name.includes('boring')) {
            newType = 'boring_bar';
        } else if (name.includes('dovetail')) {
            newType = 'dovetail_cutter';
        } else if (name.includes('engraving') || name.includes('v-bit')) {
            newType = 'chamfer_mill';
        } else if (name.includes('face mill')) {
            newType = 'face_mill';
        }

        if (newType !== t.type) {
            await prisma.tool.update({
                where: { id: t.id },
                data: { type: newType }
            });
            console.log(`Updated ${t.name}: ${t.type} -> ${newType}`);
            updated++;
        }
    }
    console.log(`Updated ${updated} tools.`);
}

main().catch(console.error).finally(async () => {
    await prisma.$disconnect();
});
