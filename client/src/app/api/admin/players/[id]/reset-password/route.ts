// client/src/app/api/admin/players/[id]/reset-password/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { generateSecureTemporaryPassword } from '@/lib/utils/credentials';
import { logAdminAction } from '@/lib/utils/auditLogger';

const Player = require('@/lib/models/Player');
const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/players/[id]/reset-password
 * Resets a player's login password and marks mustChangePassword = true.
 * Strictly admin-only; returns the generated/provided plaintext password ONCE.
 */
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { id } = await props.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid player ID format' }, { status: 400 });
  }

  try {
    await connectToDatabase();

    const player = await Player.findById(id);
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const { password, generate } = body;

    let plainPassword = '';
    if (password !== undefined && password !== null && password !== '') {
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters long' },
          { status: 400 }
        );
      }
      plainPassword = password;
    } else {
      // Auto-generate secure temporary password
      plainPassword = generateSecureTemporaryPassword(10);
    }

    // Locate linked user login account
    const playerUsername = (player.username || player.playerId || '').toLowerCase();
    let user = await User.findOne({
      $or: [
        { playerId: player._id },
        ...(playerUsername ? [{ username: playerUsername }] : []),
      ],
    });

    if (!user) {
      // Create user account if missing
      user = new User({
        name: player.name,
        username: playerUsername || `md_${player._id.toString().slice(-6)}`,
        role: 'player',
        playerId: player._id,
        password: plainPassword,
        mustChangePassword: true,
      });
    } else {
      user.password = plainPassword;
      user.mustChangePassword = true;
    }

    await user.save();

    // Audit log (STRICT: Never store passwords in the log!)
    await logAdminAction({
      actorId: auth.user.id,
      actorName: auth.user.name || 'Admin',
      actorRole: auth.user.role || 'admin',
      actorEmail: auth.user.email || '',
      action: 'player:reset_password',
      targetType: 'Player',
      targetId: player._id.toString(),
      targetName: player.name,
      details: {
        username: user.username,
        playerId: player.playerId || '',
        reason: 'Admin reset player credentials',
      },
    });

    return NextResponse.json({
      message: `Password reset successfully for player '${player.name}'`,
      username: user.username,
      password: plainPassword,
      mustChangePassword: true,
      note: 'This credential is presented once. Record or deliver it to the athlete securely.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
