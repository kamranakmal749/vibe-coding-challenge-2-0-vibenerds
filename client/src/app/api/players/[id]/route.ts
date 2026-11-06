// client/src/app/api/players/[id]/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { enrichPlayer } from '@/lib/statsService';
import { bumpSync } from '@/lib/sync';

const Player = require('@/lib/models/Player');
const User = require('@/lib/models/User');
const Session = require('@/lib/models/Session');
const Match = require('@/lib/models/Match');
const MatchParticipation = require('@/lib/models/MatchParticipation');

import { executePlayerDeletionCascade } from '@/lib/utils/playerCascade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validatePlayerData(data: any, isUpdate = false) {
  const { name, age, sport, registeredOn, defaultParticipation } = data;

  if (!isUpdate || name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return 'Player name is required';
    }
  }

  if (!isUpdate || age !== undefined) {
    const numAge = Number(age);
    if (age === undefined || age === null || isNaN(numAge) || numAge < 5 || numAge > 50) {
      return 'Age must be a number between 5 and 50';
    }
  }

  if (!isUpdate || sport !== undefined) {
    if (!sport || typeof sport !== 'string' || !sport.trim()) {
      return 'Sport is required';
    }
  }

  if (registeredOn !== undefined && registeredOn !== null) {
    const regDate = new Date(registeredOn);
    if (isNaN(regDate.getTime())) {
      return 'registeredOn must be a valid date';
    }
    if (regDate.getTime() > Date.now() + 60000) {
      return 'registeredOn cannot be in the future';
    }
  }

  if (defaultParticipation !== undefined && defaultParticipation !== null) {
    if (!['practice', 'match', 'both'].includes(defaultParticipation)) {
      return 'defaultParticipation must be practice, match, or both';
    }
  }

  return null;
}

function getPlayerFilter(idParam: string) {
  const isObjectId = mongoose.Types.ObjectId.isValid(idParam);
  return isObjectId
    ? { $or: [{ _id: idParam }, { playerId: idParam.toLowerCase() }, { username: idParam.toLowerCase() }] }
    : { $or: [{ playerId: idParam.toLowerCase() }, { username: idParam.toLowerCase() }] };
}

// GET /api/players/:id
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { id } = await params;
    await connectToDatabase();
    const filter = getPlayerFilter(id);

    const player = await Player.findOne(filter).populate('coach', 'name');
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    if (auth.user.role === 'player' && auth.user.playerId?.toString() !== player._id.toString()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const enriched = await enrichPlayer(player);
    return NextResponse.json(enriched);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Update handler shared between PATCH and PUT
async function handleUpdate(
  req: Request,
  params: Promise<{ id: string }>
) {
  const auth = await authenticateRequest(req, ['admin', 'coach']);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { id } = await params;
    await connectToDatabase();
    const filter = getPlayerFilter(id);

    const player = await Player.findOne(filter);
    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    if (auth.user.role === 'coach' && player.coach.toString() !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const error = validatePlayerData(body, true);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const { name, age, sport, registeredOn, defaultParticipation } = body;
    if (name !== undefined) player.name = name.trim();
    if (age !== undefined) player.age = Number(age);
    if (sport !== undefined) player.sport = sport.trim();
    if (registeredOn !== undefined) player.registeredOn = new Date(registeredOn);
    if (defaultParticipation !== undefined) player.defaultParticipation = defaultParticipation;

    await player.save();

    if (name !== undefined) {
      await User.updateMany({ playerId: player._id }, { name: player.name });
    }

    await bumpSync('player:updated');
    const enriched = await enrichPlayer(player);
    return NextResponse.json(enriched);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// PATCH /api/players/:id
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUpdate(req, params);
}

// PUT /api/players/:id
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUpdate(req, params);
}

/**
 * DELETE /api/players/:id (Admin only)
 * Permanent deletion with full cascade
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(req, ['admin']);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid player ID format' }, { status: 400 });
    }

    await connectToDatabase();
    const player = await Player.findById(id);
    if (!player) {
      return NextResponse.json({ error: 'Player not found or already deleted' }, { status: 404 });
    }

    const result = await executePlayerDeletionCascade(player, auth.user);

    return NextResponse.json({
      message: `Player "${result.playerName}" and associated login account permanently removed.`,
      playerId: result.playerId.toString(),
    });
  } catch (err: any) {
    console.error('Player deletion error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to remove player' },
      { status: 500 }
    );
  }
}
