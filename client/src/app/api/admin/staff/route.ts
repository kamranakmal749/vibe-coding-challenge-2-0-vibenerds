// client/src/app/api/admin/staff/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { generateSecureTemporaryPassword } from '@/lib/utils/credentials';

const User = require('@/lib/models/User');
const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERNAME_REGEX = /^[a-z0-9._]{3,30}$/;

/**
 * GET /api/admin/staff
 * Lists all staff accounts (role: coach or scout).
 * Strictly admin-only; never returns password hashes.
 */
export async function GET(req: Request) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();

    const staffMembers = await User.find({ role: { $in: ['coach', 'scout'] } })
      .select('_id name username email role mustChangePassword createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();

    // Attach assigned player counts for coaches to inform the admin UI
    const coaches = staffMembers.filter((s: any) => s.role === 'coach');
    const coachIds = coaches.map((c: any) => c._id);

    const playerCounts = await Player.aggregate([
      { $match: { coach: { $in: coachIds } } },
      { $group: { _id: '$coach', count: { $sum: 1 } } },
    ]);

    const countMap = new Map<string, number>();
    playerCounts.forEach((p: any) => countMap.set(p._id.toString(), p.count));

    const result = staffMembers.map((member: any) => ({
      ...member,
      id: member._id.toString(),
      assignedPlayersCount: member.role === 'coach' ? (countMap.get(member._id.toString()) || 0) : 0,
    }));

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/staff
 * Creates a new coach or scout account.
 * Body: { name, username, email?, role: "coach" | "scout", password?, generate?: boolean }
 */
export async function POST(req: Request) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const { name, email, role, password, generate } = body;
    let { username } = body;

    // 1. Role validation: strictly coach or scout
    if (!role || (role !== 'coach' && role !== 'scout')) {
      return NextResponse.json(
        { error: 'Role must be strictly either coach or scout' },
        { status: 400 }
      );
    }

    // 2. Name validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Staff name is required' },
        { status: 400 }
      );
    }

    // 3. Username validation: trimmed, lowercase, 3-30 chars, letters/digits/dot/underscore
    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      );
    }
    username = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(username)) {
      return NextResponse.json(
        { error: 'Username must be 3-30 characters long and contain only lowercase letters, digits, dots, or underscores' },
        { status: 400 }
      );
    }

    // Check username uniqueness
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return NextResponse.json(
        { error: `Username '${username}' is already taken. Please choose a different username.` },
        { status: 409 }
      );
    }

    // 4. Email validation (optional)
    let cleanEmail: string | undefined = undefined;
    if (email && typeof email === 'string' && email.trim()) {
      cleanEmail = email.trim().toLowerCase();
      const existingEmail = await User.findOne({ email: cleanEmail });
      if (existingEmail) {
        return NextResponse.json(
          { error: `Email '${cleanEmail}' is already registered with another account.` },
          { status: 409 }
        );
      }
    }

    // 5. Password handling
    let plainPassword = '';
    if (generate === true || (!password && generate)) {
      plainPassword = generateSecureTemporaryPassword(10);
    } else if (password) {
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters long' },
          { status: 400 }
        );
      }
      plainPassword = password;
    } else {
      return NextResponse.json(
        { error: 'Password is required (minimum 8 characters) or specify generate: true' },
        { status: 400 }
      );
    }

    // 6. Create User document (pre-save hook hashes password with bcryptjs)
    const newUser = new User({
      name: name.trim(),
      username,
      email: cleanEmail,
      role,
      password: plainPassword,
      mustChangePassword: true, // Temporary credential requirement
    });

    await newUser.save();

    return NextResponse.json(
      {
        message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully`,
        user: {
          id: newUser._id.toString(),
          _id: newUser._id.toString(),
          name: newUser.name,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
          mustChangePassword: newUser.mustChangePassword,
          createdAt: newUser.createdAt,
        },
        generatedPassword: plainPassword,
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'Field';
      return NextResponse.json(
        { error: `${field.charAt(0).toUpperCase() + field.slice(1)} is already in use.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

