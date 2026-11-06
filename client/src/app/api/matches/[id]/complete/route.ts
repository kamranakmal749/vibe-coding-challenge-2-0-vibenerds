// client/src/app/api/matches/[id]/complete/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import {
  getStandardTeamSize,
  getMatchUnlockDateTime,
  getEffectiveNow,
} from '@/lib/clock';
import { bumpSync } from '@/lib/sync';
import { syncSessionMatchConflicts } from '@/lib/statsService';

const Match = require('@/lib/models/Match');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
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

    if (match.status === 'completed') {
      return NextResponse.json({ error: 'Match is already completed' }, { status: 409 });
    }
    if (match.status === 'cancelled') {
      return NextResponse.json({ error: 'Cannot complete a cancelled match' }, { status: 409 });
    }

    const unlockTime = getMatchUnlockDateTime(match);
    const effectiveNow = getEffectiveNow(req);
    if (effectiveNow.getTime() < unlockTime.getTime()) {
      const unlockStr = unlockTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      });
      return NextResponse.json(
        {
          error: `Cannot complete match before scoring unlock time (${unlockStr})`,
          unlockTime: unlockTime.toISOString(),
          locked: true,
        },
        { status: 403 }
      );
    }

    if (!match.selectedPlayers || match.selectedPlayers.length === 0) {
      return NextResponse.json(
        { error: 'Cannot complete a match with no selected players' },
        { status: 422 }
      );
    }

    const selectedIds = (match.selectedPlayers || []).map((pid: any) =>
      (pid._id || pid).toString()
    );
    const minTeamSize = getStandardTeamSize(match.sport);
    if (selectedIds.length < minTeamSize) {
      return NextResponse.json(
        {
          error: `${match.sport} requires at least ${minTeamSize} selected players to complete the match, but only ${selectedIds.length} were selected.`,
        },
        { status: 400 }
      );
    }

    const participations = await MatchParticipation.find({ match: match._id });
    const partMap = new Map<string, any>(
      participations.map((p: any) => [
        (p.player?._id || p.player).toString(),
        p,
      ])
    );

    const missingParticipation: string[] = [];
    for (const pid of selectedIds) {
      const p = partMap.get(pid);
      if (!p || p.played === null || p.played === undefined) {
        missingParticipation.push(pid);
      }
    }

    if (missingParticipation.length > 0) {
      return NextResponse.json(
        {
          error:
            'All selected players must have a Played/Not Played status before completing the match',
          missingStatusPlayerIds: missingParticipation,
          missingPlayerIds: missingParticipation,
        },
        { status: 422 }
      );
    }

    match.status = 'completed';
    match.editUnlockedUntil = null;
    await match.save();

    if (match.sessionId) {
      await syncSessionMatchConflicts(match.sessionId);
    }

    await bumpSync('match:completed');

    return NextResponse.json({
      message: 'Match marked as completed',
      match,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
