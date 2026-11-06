// client/src/app/api/sessions/[id]/bulk/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { bumpSync } from '@/lib/sync';
import { syncDraftRoster, mergeAttendancePayload } from '@/lib/utils/sessionHelper';
import { syncSessionMatchConflicts } from '@/lib/statsService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');

/**
 * PATCH /api/sessions/:id/bulk (coach or admin)
 * Update attendance array in bulk. If save: true, atomically finalizes and locks.
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

    const body = await req.json().catch(() => ({}));
    const { attendance = [], save = false } = body;

    // Keep draft rosters aligned before applying the client update
    await syncDraftRoster(session);
    const formattedAttendance = await mergeAttendancePayload(session, attendance);

    if (save) {
      const updated = await Session.findOneAndUpdate(
        { _id: id, saved: false, locked: false },
        {
          attendance: formattedAttendance,
          initialRosterPlayerIds: formattedAttendance.map((a: any) => a.player),
          saved: true,
          savedAt: new Date(),
          locked: true,
        },
        { returnDocument: 'after' }
      ).populate('attendance.player', 'name age sport defaultParticipation');

      if (!updated) {
        return NextResponse.json(
          { error: 'Attendance is saved and cannot be changed' },
          { status: 409 }
        );
      }

      const conflictInfo = await syncSessionMatchConflicts(updated._id);
      await bumpSync('attendance:updated');
      return NextResponse.json({
        message: 'Attendance saved and finalized',
        session: updated,
        conflicts: conflictInfo,
      });
    }

    // Draft update (not saved yet)
    session.attendance = formattedAttendance;
    session.initialRosterPlayerIds = formattedAttendance.map((a: any) => a.player);
    session.createdWithCount = formattedAttendance.length;
    await session.save();

    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await session.populate('attendance.player', 'name age sport defaultParticipation');
    await bumpSync('attendance:updated');

    return NextResponse.json({
      message: 'Attendance updated',
      session,
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
