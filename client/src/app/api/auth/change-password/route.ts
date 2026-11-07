// client/src/app/api/auth/change-password/route.ts
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/db';
import { authenticateRequest, getJwtSecret } from '@/lib/auth';

const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const auth = await authenticateRequest(req);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return NextResponse.json(
        { error: 'New password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    const user = await User.findById(auth.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // If currentPassword is provided, verify it
    if (currentPassword) {
      const match = await user.comparePassword(currentPassword);
      if (!match) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }
    }

    // Verify new password is not identical to current
    const isSame = await user.comparePassword(newPassword.trim());
    if (isSame) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 }
      );
    }

    // Assign plain password; User.js pre-save hook will hash it with bcryptjs
    user.password = newPassword.trim();
    user.mustChangePassword = false;
    await user.save();

    const jwtSecret = getJwtSecret();
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name,
        username: user.username,
        email: user.email,
        playerId: user.playerId,
        mustChangePassword: false,
      },
      jwtSecret,
      { expiresIn: '8h' }
    );

    return NextResponse.json({
      message: 'Password successfully updated',
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        username: user.username,
        email: user.email,
        playerId: user.playerId,
        mustChangePassword: false,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

