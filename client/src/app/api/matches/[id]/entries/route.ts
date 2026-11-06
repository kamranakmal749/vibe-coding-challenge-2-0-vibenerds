// client/src/app/api/matches/[id]/entries/route.ts
// Deprecated legacy entries endpoint (Phase 2), preserved 1:1 for backwards compatibility.
// NOTE: Express omits broadcastServerSync on this route; Next.js intentionally omits bumpSync for frozen parity.
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { getMatchUnlockDateTime, getEffectiveNow } from '@/lib/clock';
import { findAnySession } from '@/lib/utils/matchQueries';

const Match = require('@/lib/models/Match');

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

    if (match.status !== 'completed') {
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
            error: `Scoring is locked until ${unlockStr} (60 minutes after match kickoff)`,
            unlockTime: unlockTime.toISOString(),
            locked: true,
          },
          { status: 403 }
        );
      }
    }

    const session = await findAnySession(match.coach, match.sport, match.date);
    const savedSession =
      session && (session.saved || session.locked) ? session : null;
    if (!savedSession) {
      return NextResponse.json(
        { error: 'Save attendance for this date before scoring the match' },
        { status: 409 }
      );
    }

    match.sessionId = savedSession._id;

    const eligibleMap = new Map<string, any>();
    const absentIds = new Set<string>();

    for (const entry of savedSession.attendance || []) {
      const pid = (entry.player?._id || entry.player).toString();
      if (entry.status === 'present') {
        eligibleMap.set(pid, entry);
      } else {
        absentIds.add(pid);
      }
    }

    const body = await req.json().catch(() => ({}));
    const rawEntries = Array.isArray(body.entries)
      ? body.entries
      : Array.isArray(body)
      ? body
      : [];

    const rejectedAbsent: string[] = [];
    const rejectedUnknown: string[] = [];

    for (const item of rawEntries) {
      const pid = (item.playerId || item.player?._id || item.player)?.toString();
      if (!pid) continue;

      if (absentIds.has(pid)) {
        rejectedAbsent.push(pid);
      } else if (!eligibleMap.has(pid)) {
        rejectedUnknown.push(pid);
      }
    }

    if (rejectedAbsent.length > 0) {
      return NextResponse.json(
        {
          error: 'Absent on this date',
          reason: 'Absent on this date',
          playerIds: rejectedAbsent,
        },
        { status: 422 }
      );
    }

    if (rejectedUnknown.length > 0) {
      return NextResponse.json(
        {
          error: 'Player not eligible for this match',
          reason: 'Player not eligible for this match',
          playerIds: rejectedUnknown,
        },
        { status: 422 }
      );
    }

    const submittedMap = new Map<string, any>();
    for (const item of rawEntries) {
      const pid = (item.playerId || item.player?._id || item.player)?.toString();
      if (!pid) {
        return NextResponse.json(
          { error: 'Missing player ID in entry' },
          { status: 422 }
        );
      }
      if (submittedMap.has(pid)) {
        return NextResponse.json(
          { error: `Duplicate entry for player ${pid}` },
          { status: 422 }
        );
      }
      submittedMap.set(pid, item);
    }

    const missingIds: string[] = [];
    for (const eligibleId of eligibleMap.keys()) {
      if (!submittedMap.has(eligibleId)) {
        missingIds.push(eligibleId);
      }
    }

    if (missingIds.length > 0) {
      return NextResponse.json(
        {
          error: 'Needs a score or Did not play',
          reason: 'Needs a score or Did not play',
          missingPlayerIds: missingIds,
        },
        { status: 422 }
      );
    }

    const validatedEntries: any[] = [];
    for (const [pid, item] of submittedMap.entries()) {
      const { result, score } = item;
      if (!['played', 'did_not_play'].includes(result)) {
        return NextResponse.json(
          {
            error: `Invalid result '${result}' for player ${pid}. Must be played or did_not_play.`,
          },
          { status: 422 }
        );
      }

      if (result === 'played') {
        const numScore = Number(score);
        if (
          score === null ||
          score === undefined ||
          isNaN(numScore) ||
          !Number.isInteger(numScore) ||
          numScore < 0 ||
          numScore > 20
        ) {
          return NextResponse.json(
            {
              error: `Played entry requires a valid score (integer between 0 and 20) for player ${pid}`,
            },
            { status: 422 }
          );
        }
        validatedEntries.push({
          player: pid,
          result: 'played',
          score: numScore,
        });
      } else {
        validatedEntries.push({
          player: pid,
          result: 'did_not_play',
          score: null,
        });
      }
    }

    match.entries = validatedEntries;
    await match.save();
    await match.populate(
      'entries.player',
      'name age sport defaultParticipation'
    );

    return NextResponse.json({
      message: 'Match entries saved successfully',
      match,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
