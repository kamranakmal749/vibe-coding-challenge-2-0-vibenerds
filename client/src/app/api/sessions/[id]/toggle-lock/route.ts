// client/src/app/api/sessions/[id]/toggle-lock/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { bumpSync } from '@/lib/sync';
import { syncDraftRoster } from '@/lib/utils/sessionHelper';
import { syncSessionMatchConflicts } from '@/lib/statsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');

/**
 * PATCH /api/sessions/:id/toggle-lock (coach or admin)
 * Toggles lock/unlock on a session
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
    }
    const session = await Session.findById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (auth.user.role === 'coach' && session.coach.toString() !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isLocked = !!session.locked;
    if (isLocked) {
      session.locked = false;
      // Note: session.saved stays true
    } else {
      // Locking a draft finalizes its register
      if (!session.saved) {
        await syncDraftRoster(session);
        session.saved = true;
        if (!session.savedAt) session.savedAt = new Date();
      }
      session.locked = true;
    }

    await session.save();
    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await session.populate('attendance.player', 'name age sport defaultParticipation');

    await bumpSync(isLocked ? 'session:unlocked' : 'session:locked');

    return NextResponse.json({
      message: isLocked ? 'Session unlocked successfully' : 'Session locked successfully',
      session,
      locked: session.locked,
      conflicts: conflictInfo,
    });
  } catch (err: any) {
    console.error('PATCH /api/sessions/:id/toggle-lock error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
