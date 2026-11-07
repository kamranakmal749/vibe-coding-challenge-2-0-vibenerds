// client/src/app/api/sessions/[id]/save/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { bumpSync } from '@/lib/sync';
import { syncDraftRoster, mergeAttendancePayload } from '@/lib/utils/sessionHelper';
import { syncSessionMatchConflicts } from '@/lib/statsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');

/**
 * PATCH /api/sessions/:id/save (coach or admin)
 * Atomic Save Attendance: Saves whole register and finalizes it cleanly. Automatically locks the session.
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

    if (session.locked) {
      return NextResponse.json(
        { error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { attendance } = body;

    // A draft must be synchronized before its roster is finalized
    if (!session.saved) {
      await syncDraftRoster(session);
    }
    const finalAttendance = await mergeAttendancePayload(session, attendance);

    // Atomic findOneAndUpdate to save attendance and automatically lock
    const updated = await Session.findOneAndUpdate(
      { _id: id, locked: false },
      {
        attendance: finalAttendance,
        initialRosterPlayerIds: finalAttendance.map((a: any) => a.player),
        saved: true,
        savedAt: session.savedAt || new Date(),
        locked: true,
      },
      { returnDocument: 'after' }
    ).populate('attendance.player', 'name age sport defaultParticipation');

    if (!updated) {
      return NextResponse.json(
        { error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' },
        { status: 409 }
      );
    }

    const conflictInfo = await syncSessionMatchConflicts(updated._id);
    await bumpSync('session:saved');

    return NextResponse.json({
      message: 'Attendance saved successfully',
      session: updated,
      conflicts: conflictInfo,
    });
  } catch (err: any) {
    if (err.status === 400) {
      return NextResponse.json(
        { error: err.message, playerIds: err.playerIds || [] },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
