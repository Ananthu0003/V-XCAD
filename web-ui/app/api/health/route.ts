import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(): Promise<Response> {
	try {
		// Verify database connectivity
		await prisma.$queryRaw`SELECT 1`;

		return NextResponse.json(
			{
				status: 'ok',
				timestamp: new Date().toISOString(),
				database: 'connected',
			},
			{ status: 200 }
		);
	} catch (error: any) {
		console.error('[Health Check] Database connectivity check failed:', error);
		return NextResponse.json(
			{
				status: 'error',
				timestamp: new Date().toISOString(),
				database: 'disconnected',
				error: error?.message || 'Database ping failed',
			},
			{ status: 503 }
		);
	}
}
