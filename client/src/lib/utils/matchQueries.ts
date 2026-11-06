// client/src/lib/utils/matchQueries.ts
import { sportRegex } from '@/lib/utils/sport';

const Session = require('@/lib/models/Session');

/**
 * Helper to find any session (saved or unsaved) for a given coach, sport, and match date.
 * Widens search window to cover both UTC and local day boundaries.
 */
export async function findAnySession(coachId: any, sport: string, matchDate: Date | string) {
  const d = new Date(matchDate);
  const minTime = Math.min(
    new Date(d).setUTCHours(0, 0, 0, 0),
    new Date(d).setHours(0, 0, 0, 0)
  );
  const maxTime = Math.max(
    new Date(d).setUTCHours(23, 59, 59, 999),
    new Date(d).setHours(23, 59, 59, 999)
  );

  const query: any = {
    sport: sportRegex(sport),
    date: { $gte: new Date(minTime), $lte: new Date(maxTime) },
  };
  if (coachId) {
    query.coach = coachId;
  }

  let session = await Session.findOne(query).populate(
    'attendance.player',
    'name age sport defaultParticipation'
  );
  if (!session && coachId) {
    session = await Session.findOne({
      sport: sportRegex(sport),
      date: { $gte: new Date(minTime), $lte: new Date(maxTime) },
    }).populate('attendance.player', 'name age sport defaultParticipation');
  }
  return session;
}

