// client/src/app/api/sessions/[id]/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { syncDraftRoster } from '@/lib/utils/sessionHelper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Session = require('@/lib/models/Session');

/**
 * GET /api/sessions/:id
 * Fetches a single session with role-based visibility:
 * - player: must be included in attendance AND session must be saved -> 403
 * - coach: must be session owner -> 403
 * - admin: all allowed
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToDatabase();
    const auth = await authenticateRequest(req, ['admin', 'coach', 'player']);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
    }
    const session = await Session.findById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (auth.user.role === 'player') {
      const isIncluded = (session.attendance || []).some(
        (a: any) => (a.player?._id || a.player)?.toString() === auth.user.playerId?.toString()
      );
      if (!isIncluded || !session.saved) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (auth.user.role === 'coach' && session.coach.toString() !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (auth.user.role !== 'player' && !session.saved) {
      await syncDraftRoster(session);
    }

    await session.populate('attendance.player', 'name age sport defaultParticipation');
    return NextResponse.json(session);
  } catch (err: any) {
    console.error('GET /api/sessions/:id error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
