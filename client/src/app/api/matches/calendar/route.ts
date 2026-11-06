// client/src/app/api/matches/calendar/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';

const Match = require('@/lib/models/Match');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();

    const url = new URL(req.url);
    const month = url.searchParams.get('month');

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: 'Valid month query param in YYYY-MM format is required' },
        { status: 400 }
      );
    }

    const [year, m] = month.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999));

    const filter: any = {
      date: { $gte: startDate, $lte: endDate },
      status: 'upcoming',
    };

    if (auth.user.role === 'coach') {
      const coachId = await resolveCoachId({ user: auth.user });
      filter.$or = [{ coach: auth.user.id }, { coach: coachId }];
    }

    const matches = await Match.find(filter)
      .sort({ date: 1, time: 1 })
      .select('title sport date time opponent venue status');

    const calendarMatches = matches.map((matchDoc: any) => ({
      _id: (matchDoc._id || matchDoc.id).toString(),
      id: (matchDoc._id || matchDoc.id).toString(),
      title: matchDoc.title,
      sport: matchDoc.sport,
      date: matchDoc.date,
      time: matchDoc.time,
      opponent: matchDoc.opponent,
      venue: matchDoc.venue,
      status: matchDoc.status,
    }));

    return NextResponse.json(calendarMatches);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
