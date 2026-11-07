// client/src/app/api/admin/players/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { enrichPlayersBatch } from '@/lib/statsService';
import { sportRegex } from '@/lib/utils/sport';

const Player = require('@/lib/models/Player');
const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/players
 * Lists all players with readiness, attendance %, and match stats.
 * Strictly admin-only; never returns passwords or password hashes.
 * Supports query filters: search, sport, coach.
 */
export async function GET(req: Request) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();

    const url = new URL(req.url);
    const searchParam = url.searchParams.get('search')?.trim();
    const sportParam = url.searchParams.get('sport')?.trim();
    const coachParam = url.searchParams.get('coach')?.trim();

    const query: any = {};

    if (sportParam && sportParam !== 'all') {
      query.sport = sportRegex(sportParam);
    }

    if (coachParam && coachParam !== 'all') {
      if (mongoose.Types.ObjectId.isValid(coachParam)) {
        query.coach = new mongoose.Types.ObjectId(coachParam);
      }
    }

    // Fetch players populated with coach details
    const players = await Player.find(query)
      .populate('coach', '_id name username email')
      .sort({ createdAt: -1 })
      .lean();

    // Enrich batch with attendance %, matches played, and readiness
    const enriched = await enrichPlayersBatch(players);

    // Fetch linked user accounts for usernames if needed
    const playerIds = players.map((p: any) => p._id);
    const linkedUsers = await User.find({
      $or: [
        { playerId: { $in: playerIds } },
        { role: 'player' },
      ],
    })
      .select('_id name username email playerId mustChangePassword')
      .lean();

    const userByPlayerId = new Map<string, any>();
    const userByUsername = new Map<string, any>();
    for (const u of linkedUsers) {
      if (u.playerId) {
        userByPlayerId.set(u.playerId.toString(), u);
      }
      if (u.username) {
        userByUsername.set(u.username.toLowerCase(), u);
      }
    }

    // Map to sanitized output shape
    let result = enriched.map((p: any) => {
      const pidStr = p._id.toString();
      const linkedUser = userByPlayerId.get(pidStr) || userByUsername.get((p.username || p.playerId || '').toLowerCase());

      const coachObj = p.coach
        ? {
            id: p.coach._id?.toString() || p.coach.toString(),
            _id: p.coach._id?.toString() || p.coach.toString(),
            name: p.coach.name || 'Assigned Coach',
            username: p.coach.username || '',
          }
        : null;

      const username = linkedUser?.username || p.username || p.playerId || '';

      return {
        id: pidStr,
        _id: pidStr,
        playerId: p.playerId || username,
        username,
        name: p.name,
        age: p.age,
        sport: p.sport,
        coach: coachObj,
        defaultParticipation: p.defaultParticipation || 'both',
        attendanceRate: typeof p.attendanceRate === 'number' ? p.attendanceRate : 0,
        matchesPlayed: typeof p.matchesPlayed === 'number' ? p.matchesPlayed : 0,
        isReady: !!p.isReady,
        registeredOn: p.registeredOn,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    // Apply search filter if provided (matching name, username, playerId, or sport)
    if (searchParam) {
      const s = searchParam.toLowerCase();
      result = result.filter((p: any) => {
        return (
          (p.name && p.name.toLowerCase().includes(s)) ||
          (p.username && p.username.toLowerCase().includes(s)) ||
          (p.playerId && p.playerId.toLowerCase().includes(s)) ||
          (p.sport && p.sport.toLowerCase().includes(s)) ||
          (p.coach && p.coach.name && p.coach.name.toLowerCase().includes(s))
        );
      });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
