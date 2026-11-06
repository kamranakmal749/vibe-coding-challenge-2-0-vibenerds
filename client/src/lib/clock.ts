// client/src/lib/clock.ts
// Match schedule, kickoff, unlock, and time status calculation utilities.
// Ported from src/routes/matches.js with strict behavioral parity.

import { istDateString, istDateTime } from './ist';

export const STANDARD_TEAM_SIZES: Record<string, number> = {
  cricket: 11,
  football: 11,
  basketball: 5,
  volleyball: 6,
  'field hockey': 11,
  hockey: 11,
  kabaddi: 7,
  'badminton singles': 1,
  'badminton doubles': 2,
  badminton: 1,
};

export function getStandardTeamSize(sport?: string): number {
  if (!sport || typeof sport !== 'string') return 11;
  const key = sport.trim().toLowerCase();
  if (STANDARD_TEAM_SIZES[key] !== undefined) {
    return STANDARD_TEAM_SIZES[key];
  }
  return 11;
}

export const NUMERIC_SPORTS = ['Football', 'Cricket', 'Basketball'];

export function parseTimeString(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr || typeof timeStr !== 'string') return { hours: 0, minutes: 0 };
  const trimmed = timeStr.trim().toLowerCase();
  const isPM = trimmed.includes('pm');
  const isAM = trimmed.includes('am');
  const clean = trimmed.replace(/[ap]m/, '').trim();
  const parts = clean.split(':').map((p) => parseInt(p, 10));
  if (isNaN(parts[0])) return { hours: 0, minutes: 0 };
  let hours = parts[0];
  const minutes = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : 0;
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  return { hours, minutes };
}

/**
 * Calculates scheduled kickoff datetime strictly in Indian Standard Time (IST, UTC+05:30).
 * Matches the behavior of Express running in Asia/Kolkata without depending on host-local timezone.
 */
export function getMatchScheduledDateTime(match: any): Date {
  if (!match || !match.date) return new Date();
  let dateStr: string;

  if (typeof match.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(match.date)) {
    dateStr = match.date.slice(0, 10);
  } else {
    dateStr = istDateString(match.date);
  }

  const { hours, minutes } = parseTimeString(match.time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return istDateTime(dateStr, `${pad(hours)}:${pad(minutes)}:00`);
}

/**
 * Scoring unlocks exactly 60 minutes after scheduled kickoff.
 */
export function getMatchUnlockDateTime(match: any): Date {
  const kickoff = getMatchScheduledDateTime(match);
  return new Date(kickoff.getTime() + 60 * 60 * 1000);
}

/**
 * Returns effective now.
 * SECURITY: x-mock-now header / mockNow query param are honored ONLY when:
 *   process.env.NODE_ENV === 'test' OR process.env.ALLOW_MOCK_NOW === 'true'.
 * In standard production environments without the flag, it returns real wall-clock new Date().
 */
export function getEffectiveNow(req?: Request): Date {
  const isMockAllowed =
    process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_NOW === 'true';

  if (isMockAllowed && req) {
    let mockVal: string | null = null;
    try {
      mockVal = req.headers.get('x-mock-now');
      if (!mockVal) {
        const url = new URL(req.url);
        mockVal = url.searchParams.get('mockNow');
      }
    } catch {
      mockVal = null;
    }

    if (mockVal) {
      const mockD = new Date(mockVal);
      if (!isNaN(mockD.getTime())) return mockD;
    }
  }

  return new Date();
}

export function getMatchTimeStatus(match: any, now: Date = new Date()): string {
  if (match.status === 'completed') return 'completed';
  if (match.status === 'cancelled') return 'cancelled';
  const kickoff = getMatchScheduledDateTime(match);
  const unlock = getMatchUnlockDateTime(match);
  const nowMs = now.getTime();
  if (nowMs < kickoff.getTime()) {
    return 'upcoming';
  } else if (nowMs < unlock.getTime()) {
    return 'in_progress';
  } else {
    return 'scoring_available';
  }
}

export function enrichMatchScheduleFields(match: any, req?: Request) {
  const now = getEffectiveNow(req);
  const scheduledDateTime = getMatchScheduledDateTime(match);
  const unlockDateTime = getMatchUnlockDateTime(match);
  const timeStatus = getMatchTimeStatus(match, now);
  const isScoringUnlocked =
    match.status === 'completed' || now.getTime() >= unlockDateTime.getTime();

  return {
    scheduledDateTime: scheduledDateTime.toISOString(),
    unlockDateTime: unlockDateTime.toISOString(),
    timeStatus,
    isScoringUnlocked,
  };
}

