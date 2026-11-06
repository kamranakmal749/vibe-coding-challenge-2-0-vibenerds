// client/src/app/api/sessions/[id]/unlock/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { bumpSync } from '@/lib/sync';
import { syncSessionMatchConflicts } from '@/lib/statsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');

/**
 * PATCH /api/sessions/:id/unlock (coach or admin)
 * Unlocks a locked session so attendance can be edited
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const auth = await authenticateRequest(req, ['admin', 'coach']);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await params;
    const session = await Session.findById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (auth.user.role === 'coach' && session.coach.toString() !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!session.locked) {
      return NextResponse.json({ error: 'Session is already unlocked' }, { status: 400 });
    }

    session.locked = false;
    // session.saved remains true so previously saved attendance is preserved
    await session.save();

    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await session.populate('attendance.player', 'name age sport defaultParticipation');
    await bumpSync('session:unlocked');

    return NextResponse.json({
      message: 'Session unlocked successfully',
      session,
      conflicts: conflictInfo,
    });
  } catch (err: any) {
    console.error('PATCH /api/sessions/:id/unlock error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
