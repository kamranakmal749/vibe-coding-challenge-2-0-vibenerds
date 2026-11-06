// client/src/app/api/matches/[id]/reopen-for-edit/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { bumpSync } from '@/lib/sync';

const Match = require('@/lib/models/Match');

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
        { error: 'Only completed matches can be reopened for editing' },
        { status: 409 }
      );
    }

    // Set 5-minute unlock window using raw Date.now() (Decision B - 1:1 parity with Express)
    const unlockDurationMs = 5 * 60 * 1000;
    match.editUnlockedUntil = new Date(Date.now() + unlockDurationMs);
    await match.save();

    await bumpSync('match:updated');

    return NextResponse.json({
      message: 'Match unlocked for participation editing for 5 minutes',
      editUnlockedUntil: match.editUnlockedUntil,
      status: match.status,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
