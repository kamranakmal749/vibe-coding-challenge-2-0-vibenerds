// client/src/app/api/players/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { resolveCoachId } from '@/lib/utils/coach';
import { sportRegex } from '@/lib/utils/sport';
import { generateSecureTemporaryPassword } from '@/lib/utils/credentials';
import { enrichPlayer, enrichPlayersBatch } from '@/lib/statsService';
import { bumpSync } from '@/lib/sync';

const Player = require('@/lib/models/Player');
const User = require('@/lib/models/User');
const Session = require('@/lib/models/Session');

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
    // Cannot be in the future (allow 60s tolerance)
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

const recentIdempotencyKeys = new Map<string, { status: number; body: any; timestamp: number }>();
setInterval(() => {
  const fiveMinAgo = Date.now() - 300000;
  for (const [k, v] of recentIdempotencyKeys.entries()) {
    if (v.timestamp < fiveMinAgo) recentIdempotencyKeys.delete(k);
  }
}, 60000);

// GET /api/players
export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    await connectToDatabase();
    let players: any[];

    if (auth.user.role === 'admin') {
      players = await Player.find().populate('coach', 'name');
    } else if (auth.user.role === 'coach') {
      players = await Player.find({ coach: auth.user.id }).populate('coach', 'name');
    } else if (auth.user.role === 'scout') {
      const allPlayers = await Player.find().populate('coach', 'name');
      const enriched = await enrichPlayersBatch(allPlayers);
      return NextResponse.json(enriched.filter((p: any) => p.isReady));
    } else {
      // Player role sees only themselves
      const p = await Player.findById(auth.user.playerId);
      const list = p ? [await enrichPlayer(p)] : [];
      return NextResponse.json(list);
    }

    const enriched = await enrichPlayersBatch(players);
    return NextResponse.json(enriched);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/players (admin or coach)
export async function POST(req: Request) {
  const auth = await authenticateRequest(req, ['admin', 'coach']);
  if (auth.errorResponse) return auth.errorResponse;

  let createdPlayer: any = null;
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const idempotencyKey = req.headers.get('x-idempotency-key') || body.idempotencyKey;
    if (idempotencyKey && recentIdempotencyKeys.has(idempotencyKey)) {
      const cached = recentIdempotencyKeys.get(idempotencyKey)!;
      return NextResponse.json(cached.body, { status: cached.status });
    }

    const error = validatePlayerData(body, false);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const { name, age, sport, registeredOn, defaultParticipation } = body;
    const coachId = await resolveCoachId({ user: auth.user }, body.coachId);
    if (!coachId) {
      return NextResponse.json(
        { error: 'No coach account is available. Create a coach before registering players.' },
        { status: 400 }
      );
    }

    // Guard against rapid duplicate submissions within 15 seconds
    const fifteenSecondsAgo = new Date(Date.now() - 15000);
    const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rapidDuplicate = await Player.findOne({
      coach: coachId,
      name: new RegExp('^' + escapedName + '$', 'i'),
      sport: sport.trim(),
      age: Number(age),
      createdAt: { $gte: fifteenSecondsAgo },
    });
    if (rapidDuplicate) {
      return NextResponse.json(
        { error: 'A player with this name, age, and sport was just registered. Duplicate submission prevented.' },
        { status: 409 }
      );
    }

    const tempPassword = generateSecureTemporaryPassword();
    const effectiveRegistrationDate =
      auth.user.role === 'admin' && registeredOn ? new Date(registeredOn) : new Date();

    createdPlayer = await Player.create({
      name: name.trim(),
      age: Number(age),
      sport: sport.trim(),
      registeredOn: effectiveRegistrationDate,
      defaultParticipation: defaultParticipation || 'both',
      coach: coachId,
    });

    const playerUsername = (createdPlayer.username || createdPlayer.playerId).toLowerCase();

    // Ensure no colliding User account exists before creation
    const existingUser = await User.findOne({
      $or: [{ playerId: createdPlayer._id }, { username: playerUsername }],
    });
    if (existingUser) {
      await Player.findByIdAndDelete(createdPlayer._id);
      createdPlayer = null;
      return NextResponse.json(
        { error: 'User account already exists for this username/player.' },
        { status: 409 }
      );
    }

    // Create User account with role PLAYER and mustChangePassword = true
    try {
      await User.create({
        name: createdPlayer.name,
        username: playerUsername,
        email: `${playerUsername}@player.com`,
        password: tempPassword,
        role: 'player',
        playerId: createdPlayer._id,
        mustChangePassword: true,
      });
    } catch (userErr: any) {
      if (createdPlayer && createdPlayer._id) {
        await Player.findByIdAndDelete(createdPlayer._id);
        createdPlayer = null;
      }
      return NextResponse.json(
        { error: `Failed to create player login credentials: ${userErr.message}. Registration rolled back.` },
        { status: 500 }
      );
    }

    // Auto-sync newly created player to any active/unlocked sessions
    try {
      const activeSessions = await Session.find({
        coach: coachId,
        sport: sportRegex(createdPlayer.sport),
        saved: false,
        locked: false,
      });

      for (const s of activeSessions) {
        const alreadyInSession = (s.attendance || []).some(
          (a: any) => (a.player?._id || a.player).toString() === createdPlayer._id.toString()
        );
        if (!alreadyInSession) {
          s.attendance.push({
            player: createdPlayer._id,
            status: 'present',
            participation: createdPlayer.defaultParticipation || 'both',
          });
          if (!(s.initialRosterPlayerIds || []).some((id: any) => id.toString() === createdPlayer._id.toString())) {
            s.initialRosterPlayerIds.push(createdPlayer._id);
          }
          s.createdWithCount = s.attendance.length;
          await s.save();
        }
      }
    } catch (sessionSyncErr) {
      console.error('Error auto-syncing new player to active sessions:', sessionSyncErr);
    }

    await bumpSync('player:created');

    const responsePayload = {
      ...(createdPlayer.toObject ? createdPlayer.toObject() : createdPlayer),
      credentials: {
        username: playerUsername,
        temporaryPassword: tempPassword,
        mustChangePassword: true,
      },
    };

    if (idempotencyKey) {
      recentIdempotencyKeys.set(idempotencyKey, { status: 201, body: responsePayload, timestamp: Date.now() });
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err: any) {
    if (createdPlayer && createdPlayer._id) {
      try {
        await Player.findByIdAndDelete(createdPlayer._id);
      } catch (_) {}
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
