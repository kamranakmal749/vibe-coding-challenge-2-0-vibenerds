// client/src/app/api/matches/[id]/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { bumpSync } from '@/lib/sync';
import {
  getStandardTeamSize,
  enrichMatchScheduleFields,
} from '@/lib/clock';
import { findAnySession } from '@/lib/utils/matchQueries';
import { syncSessionMatchConflicts } from '@/lib/statsService';

const Match = require('@/lib/models/Match');
const Player = require('@/lib/models/Player');
const Session = require('@/lib/models/Session');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid match ID format' }, { status: 400 });
    }

    const match = await Match.findById(id)
      .populate('entries.player', 'name age sport')
      .populate('selectedPlayers', 'name age sport')
      .populate('sessionId', 'date sport saved');

    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    if (auth.user.role === 'coach') {
      const coachId = await resolveCoachId({ user: auth.user });
      if (match.coach.toString() !== auth.user.id && match.coach.toString() !== coachId?.toString()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const participations = await MatchParticipation.find({ match: match._id })
      .populate('player', 'name age sport defaultParticipation')
      .lean();

    const livePlayers = await Player.find({}, '_id').lean();
    const livePlayerIds = new Set(livePlayers.map((p: any) => p._id.toString()));

    const liveParticipations = participations.filter((p: any) => {
      const pid = (p.player?._id || p.player)?.toString();
      return livePlayerIds.has(pid);
    });

    let totalPlayed = liveParticipations.filter(
      (p: any) => p.played === true && !p.attendanceConflict
    ).length;
    let totalDidNotPlay = liveParticipations.filter((p: any) => p.played === false).length;
    const totalConflicted = liveParticipations.filter((p: any) => Boolean(p.attendanceConflict)).length;

    if (totalPlayed === 0 && totalDidNotPlay === 0 && (match.entries || []).length > 0) {
      totalPlayed = (match.entries || []).filter(
        (e: any) => livePlayerIds.has((e.player?._id || e.player)?.toString()) && e.result === 'played'
      ).length;
      totalDidNotPlay = (match.entries || []).filter(
        (e: any) => livePlayerIds.has((e.player?._id || e.player)?.toString()) && e.result === 'did_not_play'
      ).length;
    }

    const session = match.sessionId
      ? await Session.findById(match.sessionId)
      : await findAnySession(match.coach, match.sport, match.date);

    const totalEligiblePlayers = session
      ? (session.attendance || []).filter((a: any) => a.player && a.status === 'present').length
      : 0;

    const matchObj = match.toObject();
    const scheduleInfo = enrichMatchScheduleFields(match, req);
    const stdSize = getStandardTeamSize(match.sport);

    return NextResponse.json({
      ...matchObj,
      _id: (match._id || match.id).toString(),
      id: (match._id || match.id).toString(),
      totalEligiblePlayers,
      eligiblePlayersCount: totalEligiblePlayers,
      standardTeamSize: stdSize,
      minTeamSize: stdSize,
      totalPlayed,
      totalDidNotPlay,
      totalConflicted,
      participations: liveParticipations,
      ...scheduleInfo,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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

    if (match.status !== 'upcoming') {
      return NextResponse.json(
        {
          error: `Cannot edit match when status is ${match.status}. Only upcoming matches can be edited.`,
        },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { title, sport, date, time, opponent, venue, description, maxSquadSize } = body;

    if (title !== undefined) match.title = title.trim();
    if (sport !== undefined) match.sport = sport.trim();
    if (time !== undefined) match.time = time.trim();
    if (opponent !== undefined) match.opponent = opponent.trim();
    if (venue !== undefined) match.venue = venue.trim();
    if (description !== undefined) match.description = description.trim();
    if (maxSquadSize !== undefined && !isNaN(parseInt(maxSquadSize, 10))) {
      match.maxSquadSize = Math.max(1, parseInt(maxSquadSize, 10));
    }
    if (date !== undefined) {
      const matchDate = new Date(date);
      if (isNaN(matchDate.getTime())) {
        return NextResponse.json({ error: 'Invalid match date' }, { status: 400 });
      }
      match.date = matchDate;
    }

    await match.save();
    await bumpSync('match:updated');

    return NextResponse.json({
      ...match.toObject(),
      ...enrichMatchScheduleFields(match, req),
    });
  } catch (err: any) {
    if (err.code === 11000) {
      return NextResponse.json(
        { error: 'A duplicate match entry already exists with these details' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(
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

    const sessionId = match.sessionId;
    await MatchParticipation.deleteMany({ match: match._id });
    await Match.findByIdAndDelete(match._id);

    if (sessionId) {
      try {
        await syncSessionMatchConflicts(sessionId);
      } catch (syncErr: any) {
        console.warn('Sync session conflict error on match delete:', syncErr.message);
      }
    }

    await bumpSync('match:deleted');
    return NextResponse.json({
      message: 'Match deleted successfully',
      matchId: id,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
