// client/src/app/api/sync/version/route.ts
import { NextResponse } from 'next/server';
import { getVersion } from '@/lib/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getVersion();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch sync version' },
      { status: 500 }
    );
  }
}
