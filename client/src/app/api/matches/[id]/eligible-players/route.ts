// client/src/app/api/matches/[id]/eligible-players/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import { findAnySession } from '@/lib/utils/matchQueries';

const Match = require('@/lib/models/Match');
const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid match ID format' }, { status: 400 });
    }

    const match = await Match.findById(id);
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    if (auth.user.role === 'coach') {
      const coachId = await resolveCoachId({ user: auth.user });
      if (match.coach.toString() !== auth.user.id && match.coach.toString() !== coachId?.toString()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const session = await findAnySession(match.coach, match.sport, match.date);
    if (!session || (!session.saved && !session.locked)) {
      const rosterPlayers = await Player.find({
        coach: match.coach,
        sport: sportRegex(match.sport),
      }).select('_id name sport defaultParticipation');

      const eligiblePlayers = rosterPlayers.map((p: any) => ({
        playerId: p._id.toString(),
        name: p.name || 'Athlete',
        sport: p.sport || match.sport,
        attendanceStatus: 'registered',
        participation: p.defaultParticipation || 'both',
      }));

      return NextResponse.json({
        sessionFound: Boolean(session),
        sessionSaved: Boolean(session && (session.saved || session.locked)),
        noSessionRequired: true,
        players: eligiblePlayers,
      });
    }

    const eligiblePlayers = (session.attendance || [])
      .filter((a: any) => a.player && a.status === 'present')
      .map((a: any) => {
        const p = a.player || {};
        const pid = (p._id || a.player)?.toString();
        return {
          playerId: pid,
          name: p.name || 'Athlete',
          sport: p.sport || match.sport,
          attendanceStatus: 'present',
          participation: a.participation,
        };
      })
      .filter((p: any) => Boolean(p.playerId));

    return NextResponse.json({
      sessionFound: true,
      sessionId: session._id,
      players: eligiblePlayers,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
