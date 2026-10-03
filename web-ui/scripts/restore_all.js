const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    const backupPath = path.resolve(__dirname, 'sessions_backup.json');
    if (!fs.existsSync(backupPath)) {
        console.log('No backup file found at:', backupPath);
        return;
    }

    const sessions = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    console.log(`Restoring ${sessions.length} sessions to database...`);

    let restored = 0;
    for (const s of sessions) {
        try {
            const existing = await prisma.cadSession.findUnique({ where: { id: s.id } });
            if (!existing) {
                await prisma.cadSession.create({
                    data: {
                        id: s.id,
                        prompt: s.prompt || 'Generated CAD Model',
                        fileName: s.fileName || null,
                        pythonScript: s.pythonScript || null,
                        parameters: s.parameters || {},
                        featureMap: s.featureMap || null,
                        annotations: s.annotations || null,
                        stlUrl: s.stlUrl || null,
                        stepUrl: s.stepUrl || null,
                        isShared: Boolean(s.isShared),
                        userId: null, // Allow all sessions to be visible across local development
                        createdAt: new Date(s.createdAt),
                        updatedAt: new Date(s.updatedAt || s.createdAt)
                    }
                });
                restored++;
            }
        } catch (err) {
            console.warn(`Failed to insert session ${s.id}:`, err.message);
        }
    }

    const total = await prisma.cadSession.count();
    console.log(`Successfully restored ${restored} sessions! Total sessions in database: ${total}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
