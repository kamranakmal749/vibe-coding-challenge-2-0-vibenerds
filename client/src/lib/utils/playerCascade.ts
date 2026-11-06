// client/src/lib/utils/playerCascade.ts
import mongoose from 'mongoose';
import { bumpSync } from '../sync';

const User = require('../models/User');
const Player = require('../models/Player');
const Session = require('../models/Session');
const Match = require('../models/Match');
const MatchParticipation = require('../models/MatchParticipation');

/**
 * Permanently deletes a player and cascades to users, draft sessions, and matches.
 * Uses MongoDB replica-set transaction when available, with a safe sequential fallback.
 * @param forceNoTx Only honored when process.env.NODE_ENV === 'test'
 */
export async function executePlayerDeletionCascade(
  player: any,
  adminUser: { id: string; name: string },
  forceNoTx = false
) {
  const playerId = player._id;
  const playerUsername = (player.playerId || player.username || '').toLowerCase();
  const playerName = player.name;

  // 1. Audit log
  console.log(
    `[AUDIT] Admin ${adminUser.name} (${adminUser.id}) executed permanent deletion of player "${playerName}" (ID: ${playerId}) at ${new Date().toISOString()}`
  );

  // In production builds (NODE_ENV !== 'test'), forceNoTx is strictly ignored
  const isTestEnv = process.env.NODE_ENV === 'test';
  const shouldBypassTx = isTestEnv && (forceNoTx || process.env.SIMULATE_NO_TX === 'true');

  let mongoSession: any = null;
  if (!shouldBypassTx) {
    try {
      mongoSession = await mongoose.startSession();
      mongoSession.startTransaction();
    } catch {
      mongoSession = null;
      console.warn('[WARN] MongoDB replica set transaction not available; falling back to non-transactional player deletion cascade');
    }
  } else {
    console.warn('[WARN] MongoDB replica set transaction bypassed via test mode; executing non-transactional fallback');
  }

  try {
    const opts = mongoSession ? { session: mongoSession } : {};

    // 2. Permanently delete associated user login account(s)
    const userFilter: any[] = [{ playerId: playerId }];
    if (playerUsername) {
      userFilter.push({ username: playerUsername });
    }
    await User.deleteMany({ $or: userFilter }, opts);

    // 3. Remove player from mutable draft/unsaved session rosters
    await Session.updateMany(
      { saved: { $ne: true }, locked: { $ne: true } },
      {
        $pull: {
          attendance: { player: playerId },
          initialRosterPlayerIds: playerId,
        },
      },
      opts
    );

    // 4. Remove player from upcoming/uncompleted matches
    await Match.updateMany(
      { status: 'upcoming' },
      { $pull: { selectedPlayers: playerId } },
      opts
    );
    await MatchParticipation.deleteMany(
      { player: playerId, played: null },
      opts
    );

    // 5. Annotate completed historical MatchParticipation records to preserve history
    await MatchParticipation.updateMany(
      { player: playerId },
      { $set: { remarks: 'Archived historical participant' } },
      opts
    );

    // 6. Permanently delete Player document
    await Player.findByIdAndDelete(playerId, opts);

    if (mongoSession) {
      await mongoSession.commitTransaction();
    }
  } catch (txErr) {
    if (mongoSession) {
      await mongoSession.abortTransaction().catch(() => {});
    }
    throw txErr;
  } finally {
    if (mongoSession) {
      mongoSession.endSession().catch(() => {});
    }
  }

  await bumpSync('player:deleted');
  return { playerName, playerId };
}

