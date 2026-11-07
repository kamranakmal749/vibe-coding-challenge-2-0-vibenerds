// client/src/app/api/admin/export/players/route.ts
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

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * GET /api/admin/export/players?format=csv
 * Generates and downloads a CSV export of the academy players.
 * Strictly admin-only; never leaks password hashes.
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

    const players = await Player.find(query)
      .populate('coach', '_id name username')
      .sort({ createdAt: -1 })
      .lean();

    const enriched = await enrichPlayersBatch(players);

    // Fetch linked user accounts for usernames
    const playerIds = players.map((p: any) => p._id);
    const linkedUsers = await User.find({
      $or: [
        { playerId: { $in: playerIds } },
        { role: 'player' },
      ],
    })
      .select('_id username playerId')
      .lean();

    const userByPlayerId = new Map<string, any>();
    const userByUsername = new Map<string, any>();
    for (const u of linkedUsers) {
      if (u.playerId) userByPlayerId.set(u.playerId.toString(), u);
      if (u.username) userByUsername.set(u.username.toLowerCase(), u);
    }

    let rows = enriched.map((p: any) => {
      const pidStr = p._id.toString();
      const linkedUser = userByPlayerId.get(pidStr) || userByUsername.get((p.username || p.playerId || '').toLowerCase());
      const username = linkedUser?.username || p.username || p.playerId || '';
      const coachName = p.coach ? (p.coach.name || 'Assigned Coach') : 'Unassigned';

      return {
        playerId: p.playerId || username,
        name: p.name,
        username,
        sport: p.sport,
        age: p.age,
        coach: coachName,
        defaultParticipation: p.defaultParticipation || 'both',
        attendanceRate: `${p.attendanceRate || 0}%`,
        matchesPlayed: p.matchesPlayed || 0,
        isReady: p.isReady ? 'Ready' : 'Not Ready',
        registeredOn: p.registeredOn ? new Date(p.registeredOn).toISOString().split('T')[0] : '',
      };
    });

    if (searchParam) {
      const s = searchParam.toLowerCase();
      rows = rows.filter((r: any) => {
        return (
          r.name.toLowerCase().includes(s) ||
          r.username.toLowerCase().includes(s) ||
          r.playerId.toLowerCase().includes(s) ||
          r.sport.toLowerCase().includes(s) ||
          r.coach.toLowerCase().includes(s)
        );
      });
    }

    const headers = [
      'Player ID',
      'Name',
      'Username',
      'Sport',
      'Age',
      'Coach',
      'Default Participation',
      'Attendance %',
      'Matches Played',
      'Trial Ready Status',
      'Registered Date',
    ];

    const csvLines = [headers.map(escapeCsvField).join(',')];

    for (const r of rows) {
      const line = [
        escapeCsvField(r.playerId),
        escapeCsvField(r.name),
        escapeCsvField(r.username),
        escapeCsvField(r.sport),
        escapeCsvField(r.age),
        escapeCsvField(r.coach),
        escapeCsvField(r.defaultParticipation),
        escapeCsvField(r.attendanceRate),
        escapeCsvField(r.matchesPlayed),
        escapeCsvField(r.isReady),
        escapeCsvField(r.registeredOn),
      ].join(',');
      csvLines.push(line);
    }

    const csvContent = csvLines.join('\r\n');

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="players-export.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
