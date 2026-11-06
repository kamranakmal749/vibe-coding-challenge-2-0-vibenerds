// client/src/app/api/sessions/[id]/lock/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { bumpSync } from '@/lib/sync';
import { syncDraftRoster } from '@/lib/utils/sessionHelper';
import { syncSessionMatchConflicts } from '@/lib/statsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');

/**
 * PATCH /api/sessions/:id/lock (coach or admin)
 * Deprecated alias that performs atomic save on current register
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

    if (session.locked) {
      return NextResponse.json(
        { error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' },
        { status: 409 }
      );
    }

    await syncDraftRoster(session);

    const updated = await Session.findOneAndUpdate(
      { _id: id, saved: false, locked: false },
      {
        attendance: session.attendance,
        initialRosterPlayerIds: (session.attendance || []).map((a: any) => a.player),
        saved: true,
        savedAt: new Date(),
        locked: true,
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return NextResponse.json(
        { error: 'Attendance is saved and cannot be changed' },
        { status: 409 }
      );
    }

    const conflictInfo = await syncSessionMatchConflicts(updated._id);
    await bumpSync('session:locked');

    return NextResponse.json({
      message: 'Session saved and locked',
      session: updated,
      conflicts: conflictInfo,
    });
  } catch (err: any) {
    console.error('PATCH /api/sessions/:id/lock error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
