// client/src/app/api/admin/staff/[id]/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { generateSecureTemporaryPassword } from '@/lib/utils/credentials';

const User = require('@/lib/models/User');
const Player = require('@/lib/models/Player');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/staff/[id]
 * Edits staff profile (name, email) or resets their password.
 * Body: { name?, email?, password?, generate?: boolean }
 */
export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { id } = await props.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid staff ID format' }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const staff = await User.findById(id);

    if (!staff) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    // Role check: Only coaches and scouts can be modified via staff management
    if (staff.role !== 'coach' && staff.role !== 'scout') {
      return NextResponse.json(
        { error: 'Cannot modify non-staff accounts through staff management' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { name, email, password, generate } = body;

    let plainPassword: string | undefined = undefined;

    // 1. Update Name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Name cannot be blank' }, { status: 400 });
      }
      staff.name = name.trim();
    }

    // 2. Update Email if provided
    if (email !== undefined) {
      if (typeof email === 'string' && email.trim()) {
        const cleanEmail = email.trim().toLowerCase();
        const existingEmail = await User.findOne({
          email: cleanEmail,
          _id: { $ne: staff._id },
        });
        if (existingEmail) {
          return NextResponse.json(
            { error: `Email '${cleanEmail}' is already registered with another account.` },
            { status: 409 }
          );
        }
        staff.email = cleanEmail;
      } else {
        staff.email = undefined;
      }
    }

    // 3. Reset Password if requested
    if (generate === true) {
      plainPassword = generateSecureTemporaryPassword(10);
      staff.password = plainPassword;
      staff.mustChangePassword = true;
    } else if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json(
          { error: 'New password must be at least 8 characters long' },
          { status: 400 }
        );
      }
      plainPassword = password;
      staff.password = plainPassword;
      staff.mustChangePassword = true;
    }

    await staff.save();

    return NextResponse.json({
      message: 'Staff member updated successfully',
      user: {
        id: staff._id.toString(),
        _id: staff._id.toString(),
        name: staff.name,
        username: staff.username,
        email: staff.email,
        role: staff.role,
        mustChangePassword: staff.mustChangePassword,
        updatedAt: staff.updatedAt,
      },
      generatedPassword: plainPassword || undefined,
    });
  } catch (err: any) {
    if (err.code === 11000) {
      return NextResponse.json({ error: 'Email or username already in use.' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/staff/[id]
 * Removes a coach or scout account.
 * Deleting a coach with assigned players is blocked unless reassignTo is provided.
 */
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { id } = await props.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid staff ID format' }, { status: 400 });
  }

  // Guard: Admin cannot delete themselves
  if (auth.user.id === id) {
    return NextResponse.json(
      { error: 'Cannot delete your own admin account' },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const staff = await User.findById(id);

    if (!staff) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
    }

    // Guard: Only coaches and scouts can be deleted here
    if (staff.role !== 'coach' && staff.role !== 'scout') {
      return NextResponse.json(
        { error: 'Cannot delete non-staff accounts through staff management' },
        { status: 403 }
      );
    }

    // Coach reassignment check
    if (staff.role === 'coach') {
      const assignedCount = await Player.countDocuments({ coach: staff._id });

      if (assignedCount > 0) {
        // Check for reassignTo in request URL or body
        const url = new URL(req.url);
        let reassignTo = url.searchParams.get('reassignTo');

        if (!reassignTo) {
          const body = await req.json().catch(() => ({}));
          reassignTo = body?.reassignTo;
        }

        if (reassignTo) {
          if (!mongoose.Types.ObjectId.isValid(reassignTo) || reassignTo === id) {
            return NextResponse.json(
              { error: 'Invalid reassignTo coach ID' },
              { status: 400 }
            );
          }

          const targetCoach = await User.findOne({ _id: reassignTo, role: 'coach' });
          if (!targetCoach) {
            return NextResponse.json(
              { error: 'The specified reassignTo coach does not exist' },
              { status: 404 }
            );
          }

          // Reassign all players to target coach
          await Player.updateMany({ coach: staff._id }, { coach: targetCoach._id });
        } else {
          return NextResponse.json(
            {
              error: `Cannot delete coach '${staff.name}' with ${assignedCount} assigned player(s). Please reassign players to another coach first.`,
              assignedPlayersCount: assignedCount,
            },
            { status: 400 }
          );
        }
      }
    }

    // Delete staff account
    await User.findByIdAndDelete(staff._id);

    return NextResponse.json({
      message: `${staff.role.charAt(0).toUpperCase() + staff.role.slice(1)} account '${staff.name}' (${staff.username}) removed successfully`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

