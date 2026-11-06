// client/src/app/api/matches/[id]/save-all/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import {
  getStandardTeamSize,
  getMatchUnlockDateTime,
  getEffectiveNow,
} from '@/lib/clock';
import { bumpSync } from '@/lib/sync';
import { findAnySession } from '@/lib/utils/matchQueries';
import { syncSessionMatchConflicts } from '@/lib/statsService';

const Match = require('@/lib/models/Match');
const Player = require('@/lib/models/Player');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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
      return NextResponse.json({ error: 'Cannot edit a cancelled match' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      selectedPlayerIds = [],
      participations = [],
      complete = false,
    } = body;

    if (!Array.isArray(selectedPlayerIds)) {
      return NextResponse.json(
        { error: 'selectedPlayerIds must be an array' },
        { status: 400 }
      );
    }

    const uniquePlayerIds = [
      ...new Set(selectedPlayerIds.map((pid: any) => pid.toString())),
    ];

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

    if (uniquePlayerIds.length > 0) {
      const invalidIds = uniquePlayerIds.filter((pid) => !eligibleMap.has(pid));
      if (invalidIds.length > 0) {
        return NextResponse.json(
          {
            error: 'One or more selected players are not eligible for this match',
            invalidPlayerIds: invalidIds,
          },
          { status: 422 }
        );
      }
    }

    const minTeamSize = getStandardTeamSize(match.sport);
    if (uniquePlayerIds.length > 0 && uniquePlayerIds.length < minTeamSize) {
      return NextResponse.json(
        {
          error: `${match.sport} requires at least ${minTeamSize} selected players, but only ${uniquePlayerIds.length} were selected.`,
        },
        { status: 400 }
      );
    }

    if (complete && uniquePlayerIds.length < minTeamSize) {
      return NextResponse.json(
        {
          error: `${match.sport} requires at least ${minTeamSize} selected players to complete the match, but only ${uniquePlayerIds.length} were selected.`,
        },
        { status: 400 }
      );
    }

    match.selectedPlayers = uniquePlayerIds;
    if (session) match.sessionId = session._id;

    const unlockTime = getMatchUnlockDateTime(match);
    const effectiveNow = getEffectiveNow(req);
    const isScoringUnlocked =
      match.status === 'completed' ||
      isUnlockedForEdit ||
      effectiveNow.getTime() >= unlockTime.getTime();

    const hasParticipationData =
      Array.isArray(participations) &&
      participations.some(
        (p: any) => p && p.played !== null && p.played !== undefined
      );

    if (hasParticipationData && !isScoringUnlocked) {
      const unlockStr = unlockTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
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

    const partMap = new Map<string, any>();
    if (Array.isArray(participations)) {
      for (const p of participations) {
        if (p && p.playerId) partMap.set(p.playerId.toString(), p);
      }
    }

    for (const pid of uniquePlayerIds) {
      const pData = partMap.get(pid);
      if (
        isScoringUnlocked &&
        pData &&
        (pData.played === true || pData.played === false)
      ) {
        const played = pData.played;
        let score: number | null = null;
        if (played === true) {
          if (
            pData.score !== null &&
            pData.score !== undefined &&
            pData.score !== ''
          ) {
            const num = Number(pData.score);
            if (isNaN(num) || num < 0 || num > 20) {
              return NextResponse.json(
                { error: 'Score for player must be strictly between 0 and 20' },
                { status: 400 }
              );
            }
            score = num;
          } else {
            score = 0;
          }
        }
        const remarks = (pData.remarks || '').trim();
        await MatchParticipation.findOneAndUpdate(
          { match: match._id, player: pid },
          { $set: { played, score, remarks } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } else {
        await MatchParticipation.findOneAndUpdate(
          { match: match._id, player: pid },
          { $setOnInsert: { played: null, score: null, remarks: '' } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    if (match.status !== 'completed') {
      await MatchParticipation.deleteMany({
        match: match._id,
        player: { $nin: uniquePlayerIds },
      });
    }

    if (complete) {
      if (!isScoringUnlocked) {
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

      if (uniquePlayerIds.length === 0) {
        return NextResponse.json(
          { error: 'Cannot complete a match with no selected players' },
          { status: 422 }
        );
      }

      const allParts = await MatchParticipation.find({ match: match._id });
      const currentPartMap = new Map<string, any>(
        allParts.map((p: any) => [
          (p.player?._id || p.player).toString(),
          p,
        ])
      );
      const missing: string[] = [];
      for (const pid of uniquePlayerIds) {
        const pRecord = currentPartMap.get(pid);
        if (
          !pRecord ||
          pRecord.played === null ||
          pRecord.played === undefined
        ) {
          missing.push(pid);
        }
      }

      if (missing.length > 0) {
        return NextResponse.json(
          {
            error:
              'All selected players must have Played or Did Not Play status recorded before completing the match',
            missingPlayerIds: missing,
          },
          { status: 422 }
        );
      }

      match.status = 'completed';
      match.editUnlockedUntil = null;
    }

    const finalParts = await MatchParticipation.find({ match: match._id }).populate(
      'player',
      'name age sport defaultParticipation'
    );

    match.entries = finalParts.map((p: any) => ({
      player: p.player?._id || p.player,
      result: p.played ? 'played' : 'did_not_play',
      score: p.played
        ? p.score !== null && p.score !== undefined
          ? p.score
          : 0
        : null,
    }));

    await match.save();

    if (match.sessionId) {
      await syncSessionMatchConflicts(match.sessionId);
    }

    await bumpSync(complete ? 'match:completed' : 'match:updated');

    const populatedMatch = await Match.findById(match._id).populate(
      'selectedPlayers',
      'name age sport defaultParticipation'
    );

    return NextResponse.json({
      message: complete
        ? 'Match saved and completed successfully'
        : 'Match saved successfully',
      match: populatedMatch,
      participations: finalParts,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
