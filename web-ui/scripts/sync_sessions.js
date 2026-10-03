const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();



async function main() {
    const outputsDirs = [
        path.resolve(__dirname, '..', '..', 'outputs'),
        path.resolve(__dirname, '..', 'outputs'),
        path.resolve('outputs'),
        path.resolve('../outputs')
    ];

    let outputsDir = null;
    for (const d of outputsDirs) {
        if (fs.existsSync(d)) {
            outputsDir = d;
            break;
        }
    }

    if (!outputsDir) {
        console.log('Outputs directory not found in paths:', outputsDirs);
        return;
    }

    console.log('Scanning outputs directory:', outputsDir);
    const files = fs.readdirSync(outputsDir);
    const pyFiles = files.filter(f => f.startsWith('cad_') && f.endsWith('.py'));
    console.log(`Found ${pyFiles.length} CAD sessions on disk.`);

    let importedCount = 0;
    for (const file of pyFiles) {
        const sessionId = file.replace(/^cad_/, '').replace(/\.py$/, '');
        const filePath = path.join(outputsDir, file);
        const scriptContent = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);

        const existing = await prisma.cadSession.findUnique({ where: { id: sessionId } });
        if (!existing) {
            let params = {};
            const paramMatch = scriptContent.match(/PARAMETERS\s*=\s*(\{[\s\S]*?\n\})/);
            if (paramMatch) {
                try {
                    const cleanJson = paramMatch[1]
                        .replace(/'/g, '"')
                        .replace(/\bTrue\b/g, 'true')
                        .replace(/\bFalse\b/g, 'false')
                        .replace(/\bNone\b/g, 'null');
                    params = JSON.parse(cleanJson);
                } catch (e) {
                    params = {};
                }
            }

            // Check if there are annotations or step files
            const stepExists = fs.existsSync(path.join(outputsDir, `cad_${sessionId}.step`));
            const stlExists = fs.existsSync(path.join(outputsDir, `cad_${sessionId}.stl`));

            await prisma.cadSession.create({
                data: {
                    id: sessionId,
                    prompt: 'Parametric CAD Model',
                    fileName: stepExists ? 'model.step' : null,
                    pythonScript: scriptContent,
                    parameters: params,
                    stlUrl: stlExists ? `/api/export?session_id=${sessionId}&type=stl` : null,
                    stepUrl: stepExists ? `/api/export?session_id=${sessionId}&type=step` : null,
                    createdAt: stats.mtime,
                    updatedAt: stats.mtime
                }
            });
            console.log(`+ Imported session: ${sessionId} (${stats.mtime.toISOString()})`);
            importedCount++;
        }
    }

    console.log(`Sync complete. Imported ${importedCount} new sessions into database.`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
