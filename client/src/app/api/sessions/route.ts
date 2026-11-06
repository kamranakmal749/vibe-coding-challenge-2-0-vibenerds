// client/src/app/api/sessions/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { bumpSync } from '@/lib/sync';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import { istToday } from '@/lib/ist';
import { syncDraftRoster } from '@/lib/utils/sessionHelper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');
const Player = require('@/lib/models/Player');

/**
 * GET /api/sessions
 * Returns sessions filtered by role:
 * - coach: own sessions
 * - admin: all sessions
 * - player: own saved sessions
 */
export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const auth = await authenticateRequest(req, ['admin', 'coach', 'player']);
    if (auth.errorResponse) return auth.errorResponse;

    let filter: any = {};
    if (auth.user.role === 'coach') {
      filter = { coach: auth.user.id };
    } else if (auth.user.role === 'player') {
      filter = { 'attendance.player': auth.user.playerId, saved: true };
    }

    const sessions = await Session.find(filter).sort({ date: -1 });

    if (auth.user.role !== 'player') {
      for (const session of sessions) {
        if (!session.saved) await syncDraftRoster(session);
      }
    }

    await Session.populate(sessions, {
      path: 'attendance.player',
      select: 'name age sport defaultParticipation',
    });

    return NextResponse.json(sessions);
  } catch (err: any) {
    console.error('GET /api/sessions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/sessions
 * Opens a new attendance session for (coach, date, sport)
 * - Restricts future dates
 * - Auto-populates roster with all coach players in that sport
 * - Enforces uniqueness per (coach, date, sport) -> 409
 * - Bumps sync counter: bumpSync('session:created')
 */
export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await req.json().catch(() => ({}));
    const { date, sport } = body;
    if (!date || !sport) {
      return NextResponse.json({ error: 'date and sport are required' }, { status: 400 });
    }

    const sessionDate = new Date(date);
    if (isNaN(sessionDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 });
    }

    // Disallow future session dates: coach can only create sessions for today or past days
    const now = new Date();
    const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const utcTodayStr = now.toISOString().slice(0, 10);
    const istTodayStr = istToday();
    const latestTodayStr = [localTodayStr, utcTodayStr, istTodayStr].sort().reverse()[0];

    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const maxFutureAllowed = new Date(endOfToday.getTime() + (14 * 60 * 60 * 1000));

    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const datePart = date.slice(0, 10);
      if (datePart > latestTodayStr) {
        return NextResponse.json(
          { error: 'Cannot create attendance sessions for future dates. Please select today or a past date.' },
          { status: 400 }
        );
      }
    } else if (sessionDate > maxFutureAllowed) {
      return NextResponse.json(
        { error: 'Cannot create attendance sessions for future dates. Please select today or a past date.' },
        { status: 400 }
      );
    }

    const coachId = await resolveCoachId({ user: auth.user }, body.coachId);
    if (!coachId) {
      return NextResponse.json(
        { error: 'No coach account is available. Create a coach before opening a session.' },
        { status: 400 }
      );
    }

    // Check for existing session for (coach, date, sport)
    const dayStart = new Date(sessionDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(sessionDate);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const existing = await Session.findOne({
      coach: coachId,
      sport: sport.trim(),
      $or: [
        { date: sessionDate },
        { date: { $gte: dayStart, $lte: dayEnd } },
      ],
    });

    if (existing) {
      return NextResponse.json(
        { error: 'A session already exists for this coach, date, and sport' },
        { status: 409 }
      );
    }

    // Load all players for this coach and sport
    const players = await Player.find({ coach: coachId, sport: sportRegex(sport) });
    const initialRosterPlayerIds = players.map((p: any) => p._id);

    // CRITICAL: Draft session only. No permanent attendance records saved until Coach explicitly clicks Save Attendance
    const session = await Session.create({
      date: sessionDate,
      sport: sport.trim(),
      coach: coachId,
      saved: false,
      savedAt: null,
      locked: false,
      attendance: [],
      initialRosterPlayerIds,
      createdWithCount: initialRosterPlayerIds.length,
    });

    await bumpSync('session:created');
    return NextResponse.json(session, { status: 201 });
  } catch (err: any) {
    if (err.code === 11000) {
      return NextResponse.json(
        { error: 'A session already exists for this coach, date, and sport' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
