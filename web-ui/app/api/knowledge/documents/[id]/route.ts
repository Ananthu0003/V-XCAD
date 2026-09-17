import { NextResponse } from 'next/server';
import { getFastApiUrl, fetchWithTimeout } from '@/lib/api-config';
import { getSession } from '@/lib/auth';

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const { id } = await params;
		if (!id) {
			return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
		}

		const upstreamUrl = `${getFastApiUrl()}/knowledge/documents/${encodeURIComponent(id)}`;
		const response = await fetchWithTimeout(upstreamUrl, {
			method: 'DELETE',
		}, 15000);

		const data = await response.json();
		return NextResponse.json(data, { status: response.status });
	} catch (error: any) {
		return NextResponse.json(
			{ error: error?.message || 'Failed to delete knowledge document' },
			{ status: 500 }
		);
	}
}
