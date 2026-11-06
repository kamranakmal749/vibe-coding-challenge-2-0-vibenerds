// client/src/app/api/auth/player-account/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';

const User = require('@/lib/models/User');
const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await authenticateRequest(req, ['admin', 'coach']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const { playerId, password, email } = body;

    if (!playerId) {
      return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(playerId);
    const player = await Player.findOne({
      $or: [
        ...(isObjectId ? [{ _id: playerId }] : []),
        { playerId: String(playerId).toLowerCase() },
        { username: String(playerId).toLowerCase() },
      ],
    });

    if (!player) {
      return NextResponse.json(
        { error: 'No matching Player found. Account creation rejected.' },
        { status: 404 }
      );
    }

    const playerUsername = player.playerId || player.username;
    const existingUser = await User.findOne({
      $or: [{ playerId: player._id }, { username: playerUsername }],
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User account already exists for this player' },
        { status: 409 }
      );
    }

    const user = await User.create({
      name: player.name,
      username: playerUsername,
      email: (email || `${playerUsername}@player.com`).trim().toLowerCase(),
      password: password || 'player123',
      role: 'player',
      playerId: player._id,
    });

    return NextResponse.json(
      {
        message: 'Player account created',
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          email: user.email,
          playerId: user.playerId,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

