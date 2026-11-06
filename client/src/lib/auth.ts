// client/src/lib/auth.ts
// Ported 1:1 from src/middleware/auth.js for Next.js App Router route handlers.
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import connectToDatabase from './db';

const User = require('./models/User');
const Player = require('./models/Player');

export interface AuthUser {
  id: string;
  role: 'admin' | 'coach' | 'scout' | 'player';
  name: string;
  username: string;
  email?: string;
  playerId?: string;
  mustChangePassword?: boolean;
}

export type AuthResult =
  | { user: AuthUser; errorResponse?: never }
  | { user?: never; errorResponse: NextResponse };

/**
 * Authenticates request using Authorization: Bearer <token>.
 * Enforces:
 * - Missing token -> 401 { error: 'No token provided' }
 * - Invalid/expired token -> 401 { error: 'Invalid or expired token' }
 * - Player account removed in DB -> 401 { error: 'Account has been removed' }
 * - Player profile removed in DB -> 401 { error: 'Player profile has been removed' }
 * - Mandatory password change -> 403 { error: 'Password change required before accessing portal features', mustChangePassword: true } (exempt: /change-password and /me)
 */
export async function authenticateRequest(
  req: Request,
  allowedRoles?: string[]
): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      errorResponse: NextResponse.json({ error: 'No token provided' }, { status: 401 }),
    };
  }

  const token = authHeader.slice(7);
  const jwtSecret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

  let payload: AuthUser;
  try {
    payload = jwt.verify(token, jwtSecret) as AuthUser;
  } catch {
    return {
      errorResponse: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }),
    };
  }

  await connectToDatabase();

  // Revoke access immediately if player account or profile was permanently deleted, or if password change is pending
  if (payload.role === 'player') {
    try {
      const userDoc = await User.findById(payload.id);
      if (!userDoc) {
        return {
          errorResponse: NextResponse.json({ error: 'Account has been removed' }, { status: 401 }),
        };
      }

      // Check authoritative database value for mandatory password change
      if (userDoc.mustChangePassword) {
        const url = new URL(req.url);
        const urlPath = url.pathname;
        const isExempt =
          urlPath.startsWith('/api/auth/change-password') || urlPath.startsWith('/api/auth/me');
        if (!isExempt) {
          return {
            errorResponse: NextResponse.json(
              {
                error: 'Password change required before accessing portal features',
                mustChangePassword: true,
              },
              { status: 403 }
            ),
          };
        }
      }

      if (payload.playerId) {
        const playerDoc = await Player.findById(payload.playerId);
        if (!playerDoc) {
          return {
            errorResponse: NextResponse.json(
              { error: 'Player profile has been removed' },
              { status: 401 }
            ),
          };
        }
      }
    } catch (e: any) {
      if (e?.message && e.message.includes('Cast to ObjectId')) {
        return {
          errorResponse: NextResponse.json({ error: 'Invalid account' }, { status: 401 }),
        };
      }
    }
  }

  // Role authorization check
  if (allowedRoles && allowedRoles.length > 0) {
    if (!allowedRoles.includes(payload.role)) {
      return {
        errorResponse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      };
    }
  }

  return { user: payload };
}

/**
 * Route handler wrapper with authentication and optional role guarding.
 */
export function withAuth(
  handler: (req: Request, context: { user: AuthUser; params?: any }) => Promise<Response>,
  options?: { roles?: string[] }
) {
  return async (req: Request, context: any = {}) => {
    const auth = await authenticateRequest(req, options?.roles);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }
    return handler(req, { ...context, user: auth.user });
  };
}
