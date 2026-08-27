const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

async function main() {
    // 1. Connect to host DB
    const prismaHost = new PrismaClient({
        datasources: {
            db: {
                url: process.env.DATABASE_URL
            }
        }
    });

    console.log('Fetching sessions from host database (DATABASE_URL)...');
    const sessions = await prismaHost.cadSession.findMany();
    console.log(`Found ${sessions.length} sessions in host database.`);

    const backupFile = path.resolve(__dirname, 'sessions_backup.json');
    fs.writeFileSync(backupFile, JSON.stringify(sessions, null, 2));
    console.log(`Saved backup to ${backupFile}`);

    await prismaHost.$disconnect();

    // 2. Connect to Docker DB (if different URL)
    const dockerUrl = 'postgresql://cad_user:cad_pass@127.0.0.1:5433/cad_db?schema=public';
    const prismaDocker = new PrismaClient({
        datasources: {
            db: {
                url: dockerUrl
            }
        }
    });

    console.log('Restoring sessions to Docker PostgreSQL...');
    let restored = 0;
    for (const s of sessions) {
        const existing = await prismaDocker.cadSession.findUnique({ where: { id: s.id } });
        if (!existing) {
            await prismaDocker.cadSession.create({
                data: {
                    id: s.id,
                    prompt: s.prompt,
                    fileName: s.fileName,
                    pythonScript: s.pythonScript,
                    parameters: s.parameters,
                    featureMap: s.featureMap,
                    stlUrl: s.stlUrl,
                    stepUrl: s.stepUrl,
                    isShared: s.isShared,
                    userId: s.userId,
                    createdAt: new Date(s.createdAt),
                    updatedAt: new Date(s.updatedAt)
                }
            });
            restored++;
        }
    }

    console.log(`Successfully synced ${restored} sessions to Docker database.`);
    const totalNow = await prismaDocker.cadSession.count();
    console.log(`Total sessions in database now: ${totalNow}`);
    await prismaDocker.$disconnect();
}

main().catch(console.error);
