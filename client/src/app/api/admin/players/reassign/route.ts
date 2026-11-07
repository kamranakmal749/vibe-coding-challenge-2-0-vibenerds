// client/src/app/api/admin/players/reassign/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { logAdminAction } from '@/lib/utils/auditLogger';
import { bumpSync } from '@/lib/sync';

const Player = require('@/lib/models/Player');
const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/players/reassign
 * Reassigns one or more players to a different coach.
 * Strictly admin-only.
 * Body: { playerIds: string[], coachId: string }
 */
export async function POST(req: Request) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const { playerIds, coachId } = body;

    // 1. Validate playerIds array
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return NextResponse.json(
        { error: 'playerIds must be a non-empty array of player IDs' },
        { status: 400 }
      );
    }

    const invalidPlayerId = playerIds.find((id: any) => !id || !mongoose.Types.ObjectId.isValid(id));
    if (invalidPlayerId) {
      return NextResponse.json(
        { error: `Invalid player ID format: ${invalidPlayerId}` },
        { status: 400 }
      );
    }

    // 2. Validate coachId
    if (!coachId || !mongoose.Types.ObjectId.isValid(coachId)) {
      return NextResponse.json({ error: 'Valid coachId is required' }, { status: 400 });
    }

    const targetCoach = await User.findOne({ _id: coachId, role: 'coach' });
    if (!targetCoach) {
      return NextResponse.json(
        { error: 'Target coach not found or does not have coach role' },
        { status: 404 }
      );
    }

    const validObjectIds = playerIds.map((id: string) => new mongoose.Types.ObjectId(id));

    // 3. Reassign in database
    const updateResult = await Player.updateMany(
      { _id: { $in: validObjectIds } },
      { $set: { coach: targetCoach._id } }
    );

    await bumpSync('player:reassigned');

    // 4. Audit Log Entry
    await logAdminAction({
      actorId: auth.user.id,
      actorName: auth.user.name || 'Admin',
      actorRole: auth.user.role || 'admin',
      actorEmail: auth.user.email || '',
      action: 'player:reassign',
      targetType: 'Player',
      targetId: targetCoach._id.toString(),
      targetName: targetCoach.name,
      details: {
        newCoachId: targetCoach._id.toString(),
        newCoachName: targetCoach.name,
        reassignedCount: updateResult.modifiedCount || playerIds.length,
        playerIds,
      },
    });

    return NextResponse.json({
      message: `Successfully reassigned ${updateResult.modifiedCount || playerIds.length} player(s) to Coach ${targetCoach.name}`,
      reassignedCount: updateResult.modifiedCount || playerIds.length,
      coach: {
        id: targetCoach._id.toString(),
        name: targetCoach.name,
        username: targetCoach.username,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
