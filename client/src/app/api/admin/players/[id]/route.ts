// client/src/app/api/admin/players/[id]/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { executePlayerDeletionCascade } from '@/lib/utils/playerCascade';
import { logAdminAction } from '@/lib/utils/auditLogger';
import { bumpSync } from '@/lib/sync';

const Player = require('@/lib/models/Player');
const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SPORTS = ['football', 'cricket', 'basketball'];
const VALID_PARTICIPATION = ['practice', 'match', 'both'];

/**
 * PATCH /api/admin/players/[id]
 * Modifies an existing player profile (name, age, sport, coach, defaultParticipation).
 * Strictly admin-only.
 */
export async function PATCH(
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
    const { name, age, sport, coach, defaultParticipation } = body;

    const updatedFields: string[] = [];

    // 1. Name validation
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Player name is required' }, { status: 400 });
      }
      player.name = name.trim();
      updatedFields.push('name');
    }

    // 2. Age validation
    if (age !== undefined) {
      const numAge = Number(age);
      if (isNaN(numAge) || !Number.isInteger(numAge) || numAge < 5 || numAge > 50) {
        return NextResponse.json(
          { error: 'Age must be a valid whole number between 5 and 50' },
          { status: 400 }
        );
      }
      player.age = numAge;
      updatedFields.push('age');
    }

    // 3. Sport validation
    if (sport !== undefined) {
      if (typeof sport !== 'string' || !sport.trim()) {
        return NextResponse.json({ error: 'Sport is required' }, { status: 400 });
      }
      const normSport = sport.trim();
      if (!VALID_SPORTS.includes(normSport.toLowerCase())) {
        return NextResponse.json(
          { error: `Sport must be one of: Football, Cricket, Basketball` },
          { status: 400 }
        );
      }
      // Standardize casing (e.g. Football)
      player.sport = normSport.charAt(0).toUpperCase() + normSport.slice(1).toLowerCase();
      updatedFields.push('sport');
    }

    // 4. Coach validation
    if (coach !== undefined) {
      const coachId = typeof coach === 'object' && coach !== null ? (coach.id || coach._id) : coach;
      if (!coachId || !mongoose.Types.ObjectId.isValid(coachId)) {
        return NextResponse.json({ error: 'Invalid coach ID provided' }, { status: 400 });
      }
      const coachUser = await User.findOne({ _id: coachId, role: 'coach' });
      if (!coachUser) {
        return NextResponse.json(
          { error: 'Assigned coach not found or does not have coach role' },
          { status: 400 }
        );
      }
      player.coach = coachUser._id;
      updatedFields.push('coach');
    }

    // 5. Default Participation validation
    if (defaultParticipation !== undefined) {
      if (!VALID_PARTICIPATION.includes(defaultParticipation)) {
        return NextResponse.json(
          { error: 'defaultParticipation must be practice, match, or both' },
          { status: 400 }
        );
      }
      player.defaultParticipation = defaultParticipation;
      updatedFields.push('defaultParticipation');
    }

    await player.save();

    // If name was updated, synchronize linked User name
    if (name !== undefined) {
      await User.updateMany(
        {
          $or: [
            { playerId: player._id },
            { username: (player.username || player.playerId || '').toLowerCase() },
          ],
        },
        { $set: { name: player.name } }
      );
    }

    await bumpSync('player:updated');

    // Audit Log Entry
    await logAdminAction({
      actorId: auth.user.id,
      actorName: auth.user.name || 'Admin',
      actorRole: auth.user.role || 'admin',
      actorEmail: auth.user.email || '',
      action: 'player:edit',
      targetType: 'Player',
      targetId: player._id.toString(),
      targetName: player.name,
      details: {
        updatedFields,
        sport: player.sport,
        age: player.age,
        coachId: player.coach.toString(),
      },
    });

    const populatedPlayer = await Player.findById(player._id).populate('coach', '_id name username').lean();

    return NextResponse.json({
      message: `Player '${player.name}' updated successfully`,
      player: {
        id: populatedPlayer._id.toString(),
        _id: populatedPlayer._id.toString(),
        name: populatedPlayer.name,
        username: populatedPlayer.username || populatedPlayer.playerId,
        playerId: populatedPlayer.playerId || populatedPlayer.username,
        age: populatedPlayer.age,
        sport: populatedPlayer.sport,
        coach: populatedPlayer.coach
          ? {
              id: populatedPlayer.coach._id.toString(),
              name: populatedPlayer.coach.name,
            }
          : null,
        defaultParticipation: populatedPlayer.defaultParticipation,
        updatedAt: populatedPlayer.updatedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/players/[id]
 * Deletes a player and associated user login via cascade helper.
 * Strictly admin-only; requires { confirm: true } body.
 */
export async function DELETE(
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

    const body = await req.json().catch(() => ({}));
    if (body.confirm !== true) {
      return NextResponse.json(
        { error: 'Confirmation required to delete player. Request body must include { confirm: true }.' },
        { status: 400 }
      );
    }

    const player = await Player.findById(id);
    if (!player) {
      return NextResponse.json({ error: 'Player not found or already deleted' }, { status: 404 });
    }

    const playerName = player.name;
    const playerSport = player.sport;
    const playerUsername = player.username || player.playerId;

    // Execute cascade deletion (removes linked user, cleans uncompleted matches/sessions, deletes Player document)
    const result = await executePlayerDeletionCascade(player, auth.user);

    await bumpSync('player:deleted');

    // Audit Log Entry
    await logAdminAction({
      actorId: auth.user.id,
      actorName: auth.user.name || 'Admin',
      actorRole: auth.user.role || 'admin',
      actorEmail: auth.user.email || '',
      action: 'player:delete',
      targetType: 'Player',
      targetId: id,
      targetName: playerName,
      details: {
        sport: playerSport,
        username: playerUsername,
        cascaded: true,
      },
    });

    return NextResponse.json({
      message: `Player '${playerName}' and linked login account permanently removed.`,
      playerId: id,
      playerName,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
