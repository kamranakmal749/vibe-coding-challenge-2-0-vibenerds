// client/src/app/api/matches/[id]/edit-scores/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { bumpSync } from '@/lib/sync';

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

    if (match.status !== 'completed') {
      return NextResponse.json(
        { error: 'Only completed matches support direct score editing' },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { scores } = body;

    if (!Array.isArray(scores) || scores.length === 0) {
      return NextResponse.json(
        { error: 'scores must be a non-empty array of { playerId, score }' },
        { status: 400 }
      );
    }

    const updatedParticipations: any[] = [];
    for (const entry of scores) {
      const { playerId, score } = entry;
      if (!playerId) continue;

      const numScore = Number(score);
      if (isNaN(numScore) || numScore < 0 || numScore > 20) {
        return NextResponse.json(
          {
            error: `Invalid score ${score} for player ${playerId}. Scores must be between 0 and 20.`,
          },
          { status: 400 }
        );
      }

      const participation = await MatchParticipation.findOne({
        match: match._id,
        player: playerId,
      });

      if (!participation) {
        return NextResponse.json(
          {
            error: `No participation record found for player ${playerId} in this match`,
          },
          { status: 404 }
        );
      }
      if (participation.played !== true) {
        return NextResponse.json(
          {
            error: `Player ${playerId} is not recorded as "played". Only played players can have scores edited.`,
          },
          { status: 409 }
        );
      }

      participation.score = numScore;
      await participation.save();
      updatedParticipations.push(participation);

      const entryIdx = (match.entries || []).findIndex(
        (e: any) => (e.player?._id || e.player).toString() === playerId
      );
      if (entryIdx >= 0 && match.entries[entryIdx].result === 'played') {
        match.entries[entryIdx].score = numScore;
      }
    }

    await match.save();
    await bumpSync('match:updated');

    const populatedMatch = await Match.findById(match._id)
      .populate('selectedPlayers', 'name age sport defaultParticipation')
      .populate('sessionId', 'date sport saved');

    return NextResponse.json({
      message: 'Scores updated successfully',
      match: populatedMatch,
      updatedCount: updatedParticipations.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
