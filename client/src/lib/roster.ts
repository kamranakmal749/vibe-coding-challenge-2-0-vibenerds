// client/src/lib/roster.ts
/**
 * Unified Session Roster & Eligibility System
 * Enforces single source of truth for session roster eligibility:
 * 1. Same sport (case-insensitive)
 * 2. registeredOn on or before session date (end of day)
 * 3. defaultParticipation includes practice ('practice' or 'both')
 * 4. Same coach (if both coach IDs are defined)
 */

export interface PlayerLike {
  _id?: any;
  id?: any;
  name?: string;
  age?: number;
  sport?: string;
  coach?: any;
  registeredOn?: Date | string | null;
  defaultParticipation?: 'practice' | 'match' | 'both' | string;
  isReady?: boolean;
}

export interface SessionLike {
  _id?: any;
  id?: any;
  date?: Date | string;
  sport?: string;
  coach?: any;
  saved?: boolean;
  locked?: boolean;
  attendance?: Array<{
    player?: any;
    status?: string;
    participation?: string | null;
  }>;
}

export interface SessionRosterEntry {
  playerId: string;
  name: string;
  age: number;
  sport: string;
  isReady: boolean;
  sessionStatus: 'present' | 'absent' | 'not_recorded' | 'not_taken' | 'not_in_roster';
  participation: string | null;
  inRoster: boolean;
  hasSavedEntry: boolean;
}

/**
 * Check if a player is genuinely eligible for a given session.
 */
export function isPlayerEligibleForSession(player: PlayerLike, session: SessionLike): boolean {
  if (!player || !session) return false;

  // 1. Sport check (case-insensitive)
  const pSport = (player.sport || '').trim().toLowerCase();
  const sSport = (session.sport || '').trim().toLowerCase();
  if (!pSport || !sSport || pSport !== sSport) return false;

  // 2. Coach check (if coach specified on both)
  const pCoach = (player.coach?._id || player.coach)?.toString();
  const sCoach = (session.coach?._id || session.coach)?.toString();
  if (pCoach && sCoach && pCoach !== sCoach) return false;

  // 3. Registration date check (registeredOn <= end of session day)
  if (player.registeredOn && session.date) {
    const regDate = new Date(player.registeredOn);
    const sessDate = new Date(session.date);

    if (!isNaN(regDate.getTime()) && !isNaN(sessDate.getTime())) {
      // Local end of day
      const sessEndLocal = new Date(sessDate);
      sessEndLocal.setHours(23, 59, 59, 999);

      // UTC end of day
      const sessEndUtc = new Date(sessDate);
      sessEndUtc.setUTCHours(23, 59, 59, 999);

      const latestAllowed = sessEndLocal > sessEndUtc ? sessEndLocal : sessEndUtc;
      if (regDate > latestAllowed) {
        return false;
      }
    }
  }

  // 4. defaultParticipation check: must include practice ('practice' or 'both')
  const defaultPart = (player.defaultParticipation || 'both').toLowerCase();
  if (defaultPart !== 'practice' && defaultPart !== 'both') {
    return false;
  }

  return true;
}

/**
 * Compute the complete session roster given a session and academy players list.
 * - Eligible players with a saved attendance entry receive their recorded status.
 * - Eligible players without an entry in a locked/saved session receive 'not_recorded', with inRoster: true.
 * - Ineligible players receive inRoster: false ('not_in_roster').
 */
export function computeSessionRoster(
  session: SessionLike,
  allPlayers: PlayerLike[] = []
): SessionRosterEntry[] {
  const isFinalized = Boolean(session.saved || session.locked);
  const attendanceList = session.attendance || [];

  // Index existing attendance entries by player ID
  const attendanceMap = new Map<string, { status: string; participation: string | null }>();
  for (const entry of attendanceList) {
    const pid = (entry.player?._id || entry.player)?.toString();
    if (pid) {
      attendanceMap.set(pid, {
        status: (entry.status || 'absent').toLowerCase(),
        participation: entry.participation || null,
      });
    }
  }

  const result: SessionRosterEntry[] = [];
  const processedPlayerIds = new Set<string>();

  for (const p of allPlayers) {
    const pid = (p._id || p.id)?.toString();
    if (!pid || processedPlayerIds.has(pid)) continue;
    processedPlayerIds.add(pid);

    const savedEntry = attendanceMap.get(pid);
    const eligible = isPlayerEligibleForSession(p, session);

    // If player has a recorded entry
    if (savedEntry) {
      result.push({
        playerId: pid,
        name: p.name || 'Athlete',
        age: p.age || 18,
        sport: p.sport || session.sport || '',
        isReady: Boolean(p.isReady),
        sessionStatus: savedEntry.status === 'present' ? 'present' : 'absent',
        participation: savedEntry.status === 'absent' ? null : (savedEntry.participation || p.defaultParticipation || 'both'),
        inRoster: true,
        hasSavedEntry: true,
      });
    } else if (eligible) {
      // Eligible but no saved record: inRoster is TRUE!
      result.push({
        playerId: pid,
        name: p.name || 'Athlete',
        age: p.age || 18,
        sport: p.sport || session.sport || '',
        isReady: Boolean(p.isReady),
        sessionStatus: isFinalized ? 'not_recorded' : 'not_taken',
        participation: p.defaultParticipation || 'both',
        inRoster: true,
        hasSavedEntry: false,
      });
    } else {
      // Ineligible player (wrong sport, registered after session date, or match-only)
      result.push({
        playerId: pid,
        name: p.name || 'Athlete',
        age: p.age || 18,
        sport: p.sport || '',
        isReady: Boolean(p.isReady),
        sessionStatus: 'not_in_roster',
        participation: null,
        inRoster: false,
        hasSavedEntry: false,
      });
    }
  }

  return result;
}
