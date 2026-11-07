// client/src/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/db';
import { getJwtSecret } from '@/lib/auth';

const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const { identifier, username, email, password } = body;
    const rawIdentifier = typeof identifier === 'string' ? identifier : typeof email === 'string' ? email : typeof username === 'string' ? username : '';
    const rawId = rawIdentifier.trim().toLowerCase();

    if (!rawId || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { error: 'Username or email and password required' },
        { status: 400 }
      );
    }

    const user = await User.findOne({
      $or: [{ email: rawId }, { username: rawId }],
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const jwtSecret = getJwtSecret();
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name,
        username: user.username,
        email: user.email,
        playerId: user.playerId,
        mustChangePassword: !!user.mustChangePassword,
      },
      jwtSecret,
      { expiresIn: '8h' }
    );

    return NextResponse.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        username: user.username,
        email: user.email,
        playerId: user.playerId,
        mustChangePassword: !!user.mustChangePassword,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

