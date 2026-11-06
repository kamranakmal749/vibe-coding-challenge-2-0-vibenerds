// client/src/app/api/scout/ready/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { enrichPlayer } from '@/lib/statsService';

const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'scout']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();

    const allPlayers = await Player.find().populate('coach', 'name');
    const enriched = await Promise.all(allPlayers.map(enrichPlayer));
    const readyPlayers = enriched.filter((p: any) => p.isReady);

    return NextResponse.json(readyPlayers);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

