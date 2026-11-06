// client/src/app/api/matches/[id]/selected-players/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import { getStandardTeamSize } from '@/lib/clock';
import { bumpSync } from '@/lib/sync';
import { findAnySession } from '@/lib/utils/matchQueries';
import { syncSessionMatchConflicts } from '@/lib/statsService';

const Match = require('@/lib/models/Match');
const Player = require('@/lib/models/Player');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
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

    const body = await req.json().catch(() => ({}));
    const rawIds = body.playerIds !== undefined ? body.playerIds : body.selectedPlayerIds;
    const playerIds = Array.isArray(rawIds) ? rawIds : null;

    if (!playerIds) {
      return NextResponse.json({ error: 'playerIds must be an array' }, { status: 400 });
    }

    const session = await findAnySession(match.coach, match.sport, match.date);
    let eligibleMap: Set<string>;

    if (session && (session.saved || session.locked)) {
      eligibleMap = new Set(
        (session.attendance || [])
          .filter((a: any) => a.status === 'present')
          .map((a: any) => (a.player?._id || a.player).toString())
      );
    } else {
      const rosterPlayers = await Player.find({
        coach: match.coach,
        sport: sportRegex(match.sport),
      }).select('_id');
      eligibleMap = new Set(rosterPlayers.map((p: any) => p._id.toString()));
    }

    const invalidIds = playerIds.filter((pid: any) => !eligibleMap.has(pid.toString()));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        {
          error: 'One or more selected players are not eligible for this match',
          invalidPlayerIds: invalidIds,
        },
        { status: 422 }
      );
    }

    const uniquePlayerIds = [...new Set(playerIds.map((pid: any) => pid.toString()))];
    const minTeamSize = getStandardTeamSize(match.sport);

    if (uniquePlayerIds.length < minTeamSize) {
      return NextResponse.json(
        {
          error: `${match.sport} requires at least ${minTeamSize} selected players, but only ${uniquePlayerIds.length} were selected.`,
        },
        { status: 400 }
      );
    }

    match.selectedPlayers = uniquePlayerIds;
    if (session) match.sessionId = session._id;
    await match.save();

    for (const pid of uniquePlayerIds) {
      await MatchParticipation.findOneAndUpdate(
        { match: match._id, player: pid },
        { $setOnInsert: { played: null, score: null, remarks: '' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    if (match.status === 'upcoming') {
      await MatchParticipation.deleteMany({
        match: match._id,
        player: { $nin: uniquePlayerIds },
      });
    }

    if (session?._id) {
      await syncSessionMatchConflicts(session._id);
    }

    await bumpSync('match:updated');

    const updatedMatch = await Match.findById(match._id).populate(
      'selectedPlayers',
      'name age sport defaultParticipation'
    );

    return NextResponse.json({
      message: 'Selected players updated successfully',
      match: updatedMatch,
      selectedCount: uniquePlayerIds.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
