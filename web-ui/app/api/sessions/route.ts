import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import { resolveOutputsDir } from '@/lib/outputsDir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function autoSyncDiskSessions() {
    try {
        // Only the application's actual runtime output volume is eligible for
        // sync. Previously this also guessed at process.cwd()-relative paths
        // (e.g. '../outputs'), which in local development resolved to the
        // repository's own tracked outputs/ directory — arbitrary committed
        // fixture/test files unrelated to any real session — and silently
        // imported them as userId:null sessions. Fails safe (no-op) if the
        // runtime output directory isn't present, e.g. when running outside
        // Docker without the shared cad_outputs volume mounted.
        const outputsDir = resolveOutputsDir();

        if (!outputsDir) return;

        const files = fs.readdirSync(outputsDir);
        const pyFiles = files.filter(f => f.startsWith('cad_') && f.endsWith('.py'));

        for (const file of pyFiles) {
            const sessionId = file.replace(/^cad_/, '').replace(/\.py$/, '');
            const filePath = path.join(outputsDir, file);
            
            const existing = await prisma.cadSession.findUnique({ where: { id: sessionId } });
            if (!existing) {
                const scriptContent = fs.readFileSync(filePath, 'utf-8');
                const stats = fs.statSync(filePath);

                let params: any = {};
                const paramMatch = scriptContent.match(/PARAMETERS\s*=\s*(\{[\s\S]*?\n\})/);
                if (paramMatch) {
                    try {
                        const cleanJson = paramMatch[1]
                            .replace(/'/g, '"')
                            .replace(/\bTrue\b/g, 'true')
                            .replace(/\bFalse\b/g, 'false')
                            .replace(/\bNone\b/g, 'null');
                        params = JSON.parse(cleanJson);
                    } catch {
                        params = {};
                    }
                }

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
                }).catch(() => null);
            }
        }
    } catch (e) {
        console.warn('[autoSyncDiskSessions] Notice:', e);
    }
}

export async function GET() {
    try {
        // Authenticate BEFORE any filesystem/database side effect. autoSyncDiskSessions()
        // reads the outputs directory and can write orphaned CadSession rows; an
        // unauthenticated caller must not be able to trigger that.
        const authSession = await getSession();
        if (!authSession?.userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await autoSyncDiskSessions();

        // VEX-009: Return only the authenticated user's sessions and intentionally
        // shared sessions.  Null-user (unowned) sessions are excluded.
        const sessions = await prisma.cadSession.findMany({
            where: {
                OR: [
                    { userId: authSession.userId },
                    { isShared: true }
                ]
            },
            orderBy: {
                createdAt: 'desc'
            }
        });


        const sessionIds = sessions.map(s => s.id);
        let iterationCounts: any[] = [];
        if ((prisma as any).cadIteration) {
            iterationCounts = await (prisma as any).cadIteration.groupBy({
                by: ['sessionId'],
                where: {
                    sessionId: { in: sessionIds }
                },
                _count: {
                    id: true
                }
            }).catch(() => []);
        } else if (sessionIds.length > 0) {
            const rows = await prisma.$queryRawUnsafe<any[]>(
                `SELECT "sessionId", COUNT("id")::int as count FROM "CadIteration" WHERE "sessionId" = ANY($1) GROUP BY "sessionId"`,
                sessionIds
            ).catch(() => []);
            iterationCounts = rows.map((r: any) => ({ sessionId: r.sessionId, _count: { id: r.count } }));
        }

        const countMap = new Map<string, number>();
        iterationCounts.forEach((c: any) => {
            countMap.set(c.sessionId, c._count?.id || 0);
        });

        const formatted = sessions.map(s => ({
            ...s,
            _count: {
                iterations: countMap.get(s.id) || 0
            }
        }));

        return NextResponse.json(formatted);
    } catch (error) {
        console.error('Failed to fetch sessions:', error);
        return NextResponse.json(
            { error: 'Failed to fetch history' },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    try {
        const authSession = await getSession();
        if (!authSession?.userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // VEX-2A-005: Only delete sessions owned by the authenticated user.
        // The previous { userId: null } clause allowed mass-deletion of all
        // unowned sessions by any user (authenticated or not).
        await prisma.cadSession.deleteMany({
            where: {
                userId: authSession.userId
            }
        });
        return NextResponse.json({ message: 'History cleared' });
    } catch (error) {
        console.error('Failed to clear sessions:', error);
        return NextResponse.json(
            { error: 'Failed to clear history' },
            { status: 500 }
        );
    }
}
