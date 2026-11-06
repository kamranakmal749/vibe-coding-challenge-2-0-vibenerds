// client/src/app/api/matches/check-eligibility/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import { getStandardTeamSize } from '@/lib/clock';
import { findAnySession } from '@/lib/utils/matchQueries';

const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();

    const url = new URL(req.url);
    const sport = url.searchParams.get('sport');
    const date = url.searchParams.get('date');

    if (!sport || !date) {
      return NextResponse.json(
        { error: 'sport and date query parameters are required' },
        { status: 400 }
      );
    }

    const trimmedSport = sport.trim();
    const minTeamSize = getStandardTeamSize(trimmedSport);
    const matchDate = new Date(date);
    if (isNaN(matchDate.getTime())) {
      return NextResponse.json({ error: 'Invalid match date' }, { status: 400 });
    }

    const coachId = await resolveCoachId({ user: auth.user });
    const session = await findAnySession(coachId, trimmedSport, matchDate);
    const hasAttendance = Boolean(
      session &&
        (session.saved ||
          session.locked ||
          (session.attendance && session.attendance.length > 0))
    );

    if (!hasAttendance) {
      const totalRosterPlayers = await Player.countDocuments({
        coach: coachId,
        sport: sportRegex(trimmedSport),
      });

      if (totalRosterPlayers < minTeamSize) {
        return NextResponse.json({
          sessionFinalized: false,
          sport: trimmedSport,
          date,
          minTeamSize,
          totalEligible: totalRosterPlayers,
          totalSportPlayers: totalRosterPlayers,
          isBlocked: true,
          message: `${trimmedSport} requires at least ${minTeamSize} players, but only ${totalRosterPlayers} are registered in your academy roster.`,
          players: [],
        });
      }

      return NextResponse.json({
        sessionFinalized: false,
        sport: trimmedSport,
        date,
        minTeamSize,
        totalEligible: 0,
        totalSportPlayers: totalRosterPlayers,
        isBlocked: false,
        message:
          'Player selection will be available after practice attendance is recorded for the match date.',
        players: [],
      });
    }

    const presentPlayers = (session.attendance || [])
      .filter((a: any) => a.player && a.status === 'present')
      .map((a: any) => {
        const p = a.player || {};
        const pid = (p._id || a.player)?.toString();
        return {
          playerId: pid,
          name: p.name || 'Athlete',
          sport: p.sport || trimmedSport,
          defaultParticipation: p.defaultParticipation || 'both',
        };
      })
      .filter((p: any) => Boolean(p.playerId));

    const totalEligible = presentPlayers.length;
    const isBlocked = totalEligible < minTeamSize;
    const message = isBlocked
      ? `${trimmedSport} requires at least ${minTeamSize} eligible players, but only ${totalEligible} are available.`
      : null;

    return NextResponse.json({
      sessionFinalized: true,
      sessionId: session._id,
      sport: trimmedSport,
      date,
      minTeamSize,
      totalEligible,
      isBlocked,
      message,
      players: presentPlayers,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
