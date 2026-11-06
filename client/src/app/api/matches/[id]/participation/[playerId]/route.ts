// client/src/app/api/matches/[id]/participation/[playerId]/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import {
  getMatchUnlockDateTime,
  getEffectiveNow,
  NUMERIC_SPORTS,
} from '@/lib/clock';
import { bumpSync } from '@/lib/sync';
import { syncSessionMatchConflicts } from '@/lib/statsService';

const Match = require('@/lib/models/Match');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();
    const { id, playerId } = await params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(playerId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    const match = await Match.findById(id);
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    if (auth.user.role === 'coach') {
      const coachId = await resolveCoachId({ user: auth.user });
      if (match.coach.toString() !== auth.user.id && match.coach.toString() !== coachId?.toString()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Check completion lock and Phase 5 unlock window (Decision B: raw Date.now())
    const isUnlockedForEdit =
      match.editUnlockedUntil &&
      new Date(match.editUnlockedUntil).getTime() > Date.now();

    if (match.status === 'completed' && !isUnlockedForEdit) {
      return NextResponse.json(
        {
          error:
            'Cannot edit participation on a completed match unless unlocked for edit',
        },
        { status: 409 }
      );
    }
    if (match.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot edit participation on a cancelled match' },
        { status: 409 }
      );
    }

    // 60-minute rule: Reject score/participation updates before scheduled kickoff + 60 minutes
    if (match.status !== 'completed') {
      const unlockTime = getMatchUnlockDateTime(match);
      const effectiveNow = getEffectiveNow(req);
      if (effectiveNow.getTime() < unlockTime.getTime()) {
        const unlockStr = unlockTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        return NextResponse.json(
          {
            error: `Scoring is locked until ${unlockStr} (60 minutes after match kickoff)`,
            unlockTime: unlockTime.toISOString(),
            locked: true,
          },
          { status: 403 }
        );
      }
    }

    const body = await req.json().catch(() => ({}));
    const { played, score, remarks } = body;

    if (typeof played !== 'boolean') {
      return NextResponse.json(
        { error: 'played must be a boolean (true or false)' },
        { status: 400 }
      );
    }

    let finalScore: number | null = null;
    if (played === false) {
      finalScore = null;
    } else {
      const isNumericSport = NUMERIC_SPORTS.includes(match.sport);
      if (isNumericSport) {
        if (
          score === null ||
          score === undefined ||
          score === '' ||
          isNaN(Number(score)) ||
          Number(score) < 0 ||
          Number(score) > 20
        ) {
          return NextResponse.json(
            { error: `Score must be between 0 and 20 for ${match.sport}` },
            { status: 400 }
          );
        }
        finalScore = Number(score);
      } else {
        if (score !== undefined && score !== null && score !== '') {
          const num = Number(score);
          if (isNaN(num) || num < 0 || num > 20) {
            return NextResponse.json(
              { error: 'Score must be between 0 and 20' },
              { status: 400 }
            );
          }
          finalScore = num;
        } else {
          finalScore = null;
        }
      }
    }

    const participation = await MatchParticipation.findOneAndUpdate(
      { match: match._id, player: playerId },
      {
        played,
        score: finalScore,
        remarks: remarks !== undefined ? String(remarks).trim() : '',
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).populate('player', 'name age sport');

    const existingEntryIdx = (match.entries || []).findIndex(
      (e: any) => (e.player?._id || e.player).toString() === playerId
    );
    const legacyResult = played ? 'played' : 'did_not_play';
    const legacyScore = played ? finalScore : null;

    if (existingEntryIdx >= 0) {
      match.entries[existingEntryIdx].result = legacyResult;
      match.entries[existingEntryIdx].score = legacyScore;
    } else {
      match.entries.push({
        player: playerId,
        result: legacyResult,
        score: legacyScore,
      });
    }

    await match.save();
    if (match.sessionId) {
      await syncSessionMatchConflicts(match.sessionId);
    }

    await bumpSync('match:updated');

    return NextResponse.json({
      message: 'Participation updated successfully',
      participation,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
