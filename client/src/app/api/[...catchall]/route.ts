// client/src/app/api/[...catchall]/route.ts
// Fallback handler for unported /api/* routes: returns 404 JSON instead of HTML
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return NextResponse.json({ error: 'Route not found' }, { status: 404 });
}

export async function GET() { return notFound(); }
export async function POST() { return notFound(); }
export async function PUT() { return notFound(); }
export async function PATCH() { return notFound(); }
export async function DELETE() { return notFound(); }
