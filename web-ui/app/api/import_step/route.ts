import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	return (value || 'http://127.0.0.1:8001/api/v1').replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	let formData: FormData;
	try {
		formData = await request.clone().formData();
	} catch {
		return NextResponse.json({ error: 'Request must be multipart/form-data.' }, { status: 400 });
	}

	const upload = formData.get('file');
	if (!upload || !(upload instanceof File)) {
		return NextResponse.json({ error: 'Uploaded file is required.' }, { status: 400 });
	}

	const authSession = await getSession();
	let validUserId: string | null = null;
	if (authSession?.userId) {
		const userExists = await prisma.user.findUnique({
			where: { id: authSession.userId }
		});
		if (userExists) {
			validUserId = authSession.userId;
		}
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/import_step`, {
			method: 'POST',
			body: formData,
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			{ error: 'Unable to connect to AI engine.', detail: error instanceof Error ? error.message : undefined },
			{ status: 502 }
		);
	}

	if (!upstream.ok) {
		return NextResponse.json({ error: 'AI engine failed to import step.' }, { status: upstream.status || 502 });
	}

	const data = await upstream.json();

	// Create session with the artifacts from the backend
	const session = await prisma.cadSession.create({
		data: {
			prompt: 'Direct STEP Import',
			fileName: upload.name,
			userId: validUserId,
			pythonScript: data.script,
			stlUrl: data.artifacts?.stl_url,
			stepUrl: data.artifacts?.step_url,
			// Since it's a direct import, we might not have parameter/featureMap natively yet
			// But we save what we have to make it show up in history
		},
	});

	// Replace the backend session ID with our DB session ID so the frontend can query it
	data.session_id = session.id;

	return NextResponse.json(data);
}
