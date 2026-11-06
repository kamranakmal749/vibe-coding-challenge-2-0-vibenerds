// client/src/app/api/matches/history/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { enrichMatchScheduleFields } from '@/lib/clock';

const Match = require('@/lib/models/Match');
const Player = require('@/lib/models/Player');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();

    const url = new URL(req.url);
    const sport = url.searchParams.get('sport');
    const opponent = url.searchParams.get('opponent');
    const date = url.searchParams.get('date');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const filter: any = { status: 'completed' };
    if (auth.user.role === 'coach') {
      const coachId = await resolveCoachId({ user: auth.user });
      filter.$or = [{ coach: auth.user.id }, { coach: coachId }];
    }
    if (sport) {
      filter.sport = sport.trim();
    }
    if (opponent) {
      filter.opponent = { $regex: opponent.trim(), $options: 'i' };
    }
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const start = new Date(d);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setUTCHours(23, 59, 59, 999);
        filter.date = { $gte: start, $lte: end };
      }
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const sd = new Date(startDate);
        if (!isNaN(sd.getTime())) {
          sd.setUTCHours(0, 0, 0, 0);
          filter.date.$gte = sd;
        }
      }
      if (endDate) {
        const ed = new Date(endDate);
        if (!isNaN(ed.getTime())) {
          ed.setUTCHours(23, 59, 59, 999);
          filter.date.$lte = ed;
        }
      }
    }

    const matches = await Match.find(filter)
      .sort({ date: -1 })
      .populate('selectedPlayers', 'name age sport')
      .populate('sessionId', 'date sport saved');

    const matchIds = matches.map((m: any) => m._id);
    const livePlayers = await Player.find({}, '_id').lean();
    const livePlayerIds = new Set(livePlayers.map((p: any) => p._id.toString()));

    const participations = await MatchParticipation.find({
      match: { $in: matchIds },
    })
      .populate('player', 'name age sport defaultParticipation')
      .lean();

    const playedCountMap = new Map<string, number>();
    const matchParticipationsMap = new Map<string, any[]>();
    for (const p of participations) {
      const pid = (p.player?._id || p.player)?.toString();
      if (!livePlayerIds.has(pid)) continue;
      const mid = p.match.toString();
      if (!matchParticipationsMap.has(mid)) {
        matchParticipationsMap.set(mid, []);
      }
      matchParticipationsMap.get(mid)!.push(p);

      if (p.played === true && !p.attendanceConflict) {
        playedCountMap.set(mid, (playedCountMap.get(mid) || 0) + 1);
      }
    }

    const historyItems = matches.map((m: any) => {
      const mObj = m.toObject();
      let totalPlayed = playedCountMap.get(m._id.toString());
      if (totalPlayed === undefined) {
        totalPlayed = (m.entries || []).filter((e: any) => {
          const pid = (e.player?._id || e.player)?.toString();
          return livePlayerIds.has(pid) && e.result === 'played';
        }).length;
      }
      const scheduleInfo = enrichMatchScheduleFields(m, req);
      return {
        ...mObj,
        totalPlayed,
        participations: matchParticipationsMap.get(m._id.toString()) || [],
        ...scheduleInfo,
      };
    });

    return NextResponse.json(historyItems);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
