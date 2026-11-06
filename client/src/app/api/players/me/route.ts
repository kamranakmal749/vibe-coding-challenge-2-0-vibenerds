// client/src/app/api/players/me/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { enrichPlayer } from '@/lib/statsService';

const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    if (!auth.user.playerId) {
      return NextResponse.json(
        { error: 'No player profile associated with this account' },
        { status: 404 }
      );
    }

    await connectToDatabase();
    const player = await Player.findById(auth.user.playerId).populate('coach', 'name');
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const enriched = await enrichPlayer(player);
    return NextResponse.json(enriched);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
