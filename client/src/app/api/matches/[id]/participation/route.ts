// client/src/app/api/matches/[id]/participation/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';

const Match = require('@/lib/models/Match');
const MatchParticipation = require('@/lib/models/MatchParticipation');

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

    const match = await Match.findById(id).populate(
      'selectedPlayers',
      'name age sport defaultParticipation'
    );
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    if (auth.user.role === 'coach') {
      const coachId = await resolveCoachId({ user: auth.user });
      if (match.coach.toString() !== auth.user.id && match.coach.toString() !== coachId?.toString()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const participations = await MatchParticipation.find({ match: match._id }).populate(
      'player',
      'name age sport defaultParticipation'
    );

    const participationTable = participations.map((p: any) => {
      const playerDoc = p.player || null;
      const pid = playerDoc
        ? playerDoc._id
          ? playerDoc._id.toString()
          : playerDoc.toString()
        : p.player
        ? (p.player._id || p.player).toString()
        : 'deleted';

      return {
        playerId: pid,
        name: playerDoc ? playerDoc.name : 'Deleted Player',
        sport: playerDoc ? playerDoc.sport : match.sport,
        played: p.played,
        score: p.score,
        remarks: p.remarks || '',
        attendanceConflict: Boolean(p.attendanceConflict),
        conflictReason: p.conflictReason || '',
      };
    });

    return NextResponse.json({
      matchId: match._id,
      status: match.status,
      sport: match.sport,
      participations: participationTable,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
