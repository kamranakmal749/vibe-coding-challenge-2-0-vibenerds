// client/src/lib/utils/sessionHelper.ts
import { sportRegex } from './sport';
import { isPlayerEligibleForSession } from '../roster';

const Player = require('../models/Player');

/**
 * Draft roster synchronization
 * A draft session is mutable. Keep its roster aligned with every player the
 * coach currently has in that sport who is eligible. Saved sessions are snapshots and are
 * deliberately never changed here.
 */
export async function syncDraftRoster(session: any) {
  if (!session || session.saved || session.locked) return session;

  let changed = false;

  // Ensure initialRosterPlayerIds snapshot is initialized
  if (!session.initialRosterPlayerIds || session.initialRosterPlayerIds.length === 0) {
    const coachId = session.coach?._id || session.coach;
    const players = await Player.find({
      coach: coachId,
      sport: sportRegex(session.sport),
    });

    const eligiblePlayerIds = players
      .filter((p: any) => isPlayerEligibleForSession(p, session))
      .map((p: any) => p._id);

    session.initialRosterPlayerIds = eligiblePlayerIds;
    session.createdWithCount = session.initialRosterPlayerIds.length;
    changed = true;
  }

  if (changed) {
    await session.save();
  }

  return session;
}

/**
 * Merge a client attendance payload into the roster. Unknown player
 * IDs are rejected, and omitted roster players default to present instead of being
 * silently dropped when the register is saved.
 */
export async function mergeAttendancePayload(session: any, attendance: any) {
  const updates = new Map();
  const seen = new Set();

  if (Array.isArray(attendance)) {
    for (const item of attendance) {
      const playerId = (item.playerId || item.player?._id || item.player)?.toString();
      if (!playerId) continue;
      if (seen.has(playerId)) {
        const err: any = new Error('Duplicate attendance record for the same player in this session');
        err.status = 400;
        throw err;
      }
      seen.add(playerId);
      updates.set(playerId, item);
    }
  }

  const coachId = session.coach?._id || session.coach;

  const rosterIds = new Set(
    (session.initialRosterPlayerIds && session.initialRosterPlayerIds.length > 0
      ? session.initialRosterPlayerIds
      : (session.attendance || []).map((a: any) => a.player)
    ).map((p: any) => (p?._id || p)?.toString()).filter(Boolean)
  );

  if (coachId) {
    const activePlayers = await Player.find({
      coach: coachId,
      sport: sportRegex(session.sport),
    });
    activePlayers
      .filter((p: any) => isPlayerEligibleForSession(p, session))
      .forEach((p: any) => rosterIds.add(p._id.toString()));
  }

  if (rosterIds.size === 0) {
    for (const id of updates.keys()) rosterIds.add(id);
  }

  const unknownIds = [...updates.keys()].filter(id => !rosterIds.has(id));
  if (unknownIds.length) {
    const err: any = new Error('Attendance contains players who are not part of this session roster');
    err.status = 400;
    err.playerIds = unknownIds;
    throw err;
  }

  const existingMap = new Map();
  for (const entry of (session.attendance || [])) {
    const id = (entry.player?._id || entry.player)?.toString();
    if (id) existingMap.set(id, entry);
  }

  const allTargetIds = new Set([...updates.keys(), ...rosterIds]);

  return Array.from(allTargetIds).map(id => {
    const update = updates.get(id);
    const existing = existingMap.get(id);

    if (update) {
      const isAbsent = (update.status || '').toLowerCase() === 'absent';
      return {
        player: id,
        status: isAbsent ? 'absent' : 'present',
        participation: isAbsent
          ? null
          : (['practice', 'match', 'both'].includes(update.participation)
              ? update.participation
              : (existing?.participation || 'both')),
      };
    }

    if (existing) {
      return {
        player: existing.player,
        status: existing.status,
        participation: existing.participation,
      };
    }

    return {
      player: id,
      status: 'present',
      participation: 'both',
    };
  });
}
