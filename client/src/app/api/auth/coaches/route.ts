// client/src/app/api/auth/coaches/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';

const User = require('@/lib/models/User');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();
    const coaches = await User.find({ role: 'coach' })
      .select('name username')
      .sort({ name: 1 });

    return NextResponse.json(coaches);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

