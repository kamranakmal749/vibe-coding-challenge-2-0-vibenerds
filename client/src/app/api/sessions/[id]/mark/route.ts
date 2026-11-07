// client/src/app/api/sessions/[id]/mark/route.ts
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
 * PATCH /api/sessions/:id/mark (coach or admin)
 * Update a single athlete's attendance status in draft session
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
    const { playerId, status, participation } = body;
    const normalizedStatus = (status || '').toLowerCase();
    if (!['present', 'absent'].includes(normalizedStatus)) {
      return NextResponse.json({ error: 'status must be present or absent' }, { status: 400 });
    }

    // Ensure current player is present in draft roster before marking
    await syncDraftRoster(session);

    const entry = session.attendance.find(
      (a: any) => (a.player?._id || a.player)?.toString() === playerId?.toString()
    );
    if (!entry) {
      return NextResponse.json({ error: 'Player not in this session' }, { status: 404 });
    }

    entry.status = normalizedStatus;
    if (normalizedStatus === 'absent') {
      entry.participation = null;
    } else if (participation && ['practice', 'match', 'both'].includes(participation)) {
      entry.participation = participation;
    } else if (!entry.participation) {
      entry.participation = 'both';
    }

    await session.save();
    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await bumpSync('attendance:updated');

    return NextResponse.json({
      message: 'Updated',
      entry,
      session,
      conflicts: conflictInfo,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
