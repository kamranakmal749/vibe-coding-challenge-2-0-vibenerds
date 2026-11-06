// client/src/app/api/auth/me/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';

const User = require('@/lib/models/User');
const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();
    const user = await User.findById(auth.user.id).select('-password');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userObj = user.toObject ? user.toObject() : user;
    if (userObj.role === 'player' && userObj.playerId) {
      const playerDoc = await Player.findById(userObj.playerId).lean();
      if (playerDoc && playerDoc.name) {
        userObj.name = playerDoc.name;
      }
    }

    return NextResponse.json(userObj);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

