// client/src/app/api/matches/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import { bumpSync } from '@/lib/sync';
import {
  getStandardTeamSize,
  enrichMatchScheduleFields,
} from '@/lib/clock';
import { findAnySession } from '@/lib/utils/matchQueries';

const Match = require('@/lib/models/Match');
const Player = require('@/lib/models/Player');
const Session = require('@/lib/models/Session');
const MatchParticipation = require('@/lib/models/MatchParticipation');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();

    const url = new URL(req.url);
    const sport = url.searchParams.get('sport');
    const date = url.searchParams.get('date');
    const opponent = url.searchParams.get('opponent');
    const status = url.searchParams.get('status');

    if (auth.user.role === 'admin' || auth.user.role === 'coach') {
      const filter: any = {};
      if (auth.user.role === 'coach') {
        filter.coach = auth.user.id;
      }
      if (sport) {
        filter.sport = sport.trim();
      }
      if (status) {
        filter.status = status.trim();
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
      }

      const matches = await Match.find(filter)
        .sort({ date: -1 })
        .populate('entries.player', 'name age sport')
        .populate('selectedPlayers', 'name age sport')
        .populate('sessionId', 'date sport saved');

      const matchIds = matches.map((m: any) => m._id);
      const participations = await MatchParticipation.find({
        match: { $in: matchIds },
      })
        .populate('player', 'name age sport defaultParticipation')
        .lean();

      const playedCountMap = new Map<string, number>();
      const matchParticipationsMap = new Map<string, any[]>();
      for (const p of participations) {
        const mid = p.match.toString();
        if (!matchParticipationsMap.has(mid)) {
          matchParticipationsMap.set(mid, []);
        }
        matchParticipationsMap.get(mid)!.push(p);

        if (p.played === true && !p.attendanceConflict) {
          playedCountMap.set(mid, (playedCountMap.get(mid) || 0) + 1);
        }
      }

      const coachFilter =
        auth.user.role === 'coach'
          ? auth.user.id
          : { $in: matches.map((m: any) => m.coach) };
      const savedSessions = await Session.find({
        coach: coachFilter,
        $or: [{ saved: true }, { locked: true }],
      }).lean();

      function getEligibleCountForMatch(matchItem: any) {
        const mDate = new Date(matchItem.date);
        const mDateStr = mDate.toISOString().slice(0, 10);
        const sessionItem = savedSessions.find((s: any) => {
          if (s.sport !== matchItem.sport) return false;
          if (s.coach.toString() !== matchItem.coach.toString()) return false;
          const sDateStr = new Date(s.date).toISOString().slice(0, 10);
          return sDateStr === mDateStr;
        });
        if (!sessionItem) return 0;
        return (sessionItem.attendance || []).filter(
          (a: any) => a.player && a.status === 'present'
        ).length;
      }

      const matchObjects = matches.map((m: any) => {
        const mObj = m.toObject();
        let totalPlayed = playedCountMap.get(m._id.toString());
        if (totalPlayed === undefined) {
          totalPlayed = (m.entries || []).filter((e: any) => e.result === 'played').length;
        }
        const totalEligiblePlayers = getEligibleCountForMatch(m);
        const scheduleInfo = enrichMatchScheduleFields(m, req);
        const stdSize = getStandardTeamSize(m.sport);
        return {
          ...mObj,
          _id: (m._id || m.id).toString(),
          id: (m._id || m.id).toString(),
          totalEligiblePlayers,
          eligiblePlayersCount: totalEligiblePlayers,
          standardTeamSize: stdSize,
          minTeamSize: stdSize,
          totalPlayed,
          participations: matchParticipationsMap.get(m._id.toString()) || [],
          ...scheduleInfo,
        };
      });

      return NextResponse.json(matchObjects);
    }

    if (auth.user.role === 'player') {
      const playerId = auth.user.playerId;
      if (!playerId) return NextResponse.json([]);

      const participations = await MatchParticipation.find({
        player: playerId,
        played: true,
        attendanceConflict: { $ne: true },
      })
        .select('match')
        .lean();
      const participationMatchIds = participations.map((p: any) => p.match);

      const allMatches = await Match.find({
        $or: [
          { _id: { $in: participationMatchIds } },
          { 'entries.player': playerId, 'entries.result': 'played' },
          { 'scores.player': playerId },
        ],
      })
        .sort({ date: -1 })
        .populate('entries.player', 'name age sport')
        .populate('selectedPlayers', 'name age sport')
        .populate('sessionId', 'date sport saved');

      const matches = allMatches.filter((m: any) => {
        // If matched via modern participation
        if (participationMatchIds.some((id: any) => id.toString() === m._id.toString())) {
          return true;
        }
        // Fallback to legacy entries / scores
        if (m.entries && m.entries.length > 0) {
          const entry = m.entries.find(
            (e: any) => (e.player?._id || e.player).toString() === playerId.toString()
          );
          return entry && entry.result === 'played';
        }
        return (
          m.scores &&
          m.scores.some(
            (s: any) => (s.player?._id || s.player).toString() === playerId.toString()
          )
        );
      });

      return NextResponse.json(matches);
    }

    return NextResponse.json([]);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();

    const body = await req.json().catch(() => ({}));
    const {
      title,
      sport,
      date,
      time,
      opponent,
      venue,
      description,
      selectedPlayerIds,
      selectedPlayers,
      maxSquadSize,
    } = body;

    if (!title || !sport || !date || !time || !opponent || !venue) {
      return NextResponse.json(
        { error: 'title, sport, date, time, opponent, and venue are required' },
        { status: 400 }
      );
    }

    const matchDate = new Date(date);
    if (isNaN(matchDate.getTime())) {
      return NextResponse.json({ error: 'Invalid match date' }, { status: 400 });
    }

    const trimmedSport = sport.trim();
    const minTeamSize = getStandardTeamSize(trimmedSport);

    let parsedMaxSquad = minTeamSize;
    if (
      maxSquadSize !== undefined &&
      maxSquadSize !== null &&
      !isNaN(parseInt(maxSquadSize, 10))
    ) {
      parsedMaxSquad = Math.max(1, parseInt(maxSquadSize, 10));
    }

    const coachId = await resolveCoachId({ user: auth.user });
    const session = await findAnySession(coachId, trimmedSport, matchDate);
    const hasAttendanceSession = Boolean(
      session &&
        (session.saved ||
          session.locked ||
          (session.attendance && session.attendance.length > 0))
    );

    let finalSelected: string[] = [];

    if (hasAttendanceSession) {
      const presentPlayers = (session.attendance || []).filter(
        (a: any) => a.player && a.status === 'present'
      );
      const totalEligible = presentPlayers.length;
      if (totalEligible < minTeamSize) {
        return NextResponse.json(
          {
            error: `${trimmedSport} requires at least ${minTeamSize} eligible players, but only ${totalEligible} are available.`,
          },
          { status: 400 }
        );
      }

      const rawProvidedIds = Array.isArray(selectedPlayerIds)
        ? selectedPlayerIds
        : Array.isArray(selectedPlayers)
        ? selectedPlayers
        : null;

      if (rawProvidedIds !== null) {
        const eligibleIdSet = new Set(
          presentPlayers.map((a: any) => (a.player?._id || a.player).toString())
        );
        const uniqueIds = [
          ...new Set(rawProvidedIds.map((id: any) => (id?._id || id).toString())),
        ];

        const invalidIds = uniqueIds.filter((id) => !eligibleIdSet.has(id));
        if (invalidIds.length > 0) {
          return NextResponse.json(
            {
              error: 'One or more selected players are not eligible for this match',
              invalidPlayerIds: invalidIds,
            },
            { status: 422 }
          );
        }

        if (uniqueIds.length < minTeamSize) {
          return NextResponse.json(
            {
              error: `${trimmedSport} requires at least ${minTeamSize} selected players, but only ${uniqueIds.length} were selected.`,
            },
            { status: 400 }
          );
        }
        finalSelected = uniqueIds;
      } else {
        finalSelected = presentPlayers.map((a: any) =>
          (a.player?._id || a.player).toString()
        );
      }
    } else {
      const totalRosterPlayers = await Player.countDocuments({
        coach: coachId,
        sport: sportRegex(trimmedSport),
      });
      if (totalRosterPlayers < minTeamSize) {
        return NextResponse.json(
          {
            error: `${trimmedSport} requires at least ${minTeamSize} players, but only ${totalRosterPlayers} are registered in your academy roster.`,
          },
          { status: 400 }
        );
      }

      const rawProvidedIds = Array.isArray(selectedPlayerIds)
        ? selectedPlayerIds
        : Array.isArray(selectedPlayers)
        ? selectedPlayers
        : null;
      if (rawProvidedIds !== null) {
        const uniqueIds = [
          ...new Set(rawProvidedIds.map((id: any) => (id?._id || id).toString())),
        ];
        if (uniqueIds.length < minTeamSize) {
          return NextResponse.json(
            {
              error: `${trimmedSport} requires at least ${minTeamSize} selected players, but only ${uniqueIds.length} were selected.`,
            },
            { status: 400 }
          );
        }
        finalSelected = uniqueIds;
      } else {
        finalSelected = [];
      }
    }

    const match = await Match.create({
      title: title.trim(),
      sport: trimmedSport,
      date: matchDate,
      time: time.trim(),
      opponent: opponent.trim(),
      venue: venue.trim(),
      description: (description || '').trim(),
      coach: coachId || auth.user.id,
      sessionId: session ? session._id : null,
      selectedPlayers: finalSelected,
      maxSquadSize: parsedMaxSquad,
      status: 'upcoming',
      entries: [],
    });

    if (finalSelected.length > 0) {
      for (const pid of finalSelected) {
        await MatchParticipation.findOneAndUpdate(
          { match: match._id, player: pid },
          { $setOnInsert: { played: null, score: null, remarks: '' } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    await bumpSync('match:created');
    return NextResponse.json(match, { status: 201 });
  } catch (err: any) {
    if (err.code === 11000) {
      return NextResponse.json(
        { error: 'A duplicate match entry already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
