// client/src/lib/utils/matchQueries.ts
import { sportRegex } from '@/lib/utils/sport';
import { getWidenedDateWindow } from '@/lib/ist';

const Session = require('@/lib/models/Session');

/**
 * Helper to find any session (saved or unsaved) for a given coach, sport, and match date.
 * Widens search window to cover both UTC and IST day boundaries without host-local dependency.
 */
export async function findAnySession(coachId: any, sport: string, matchDate: Date | string) {
  const { minDate, maxDate } = getWidenedDateWindow(matchDate);

  const query: any = {
    sport: sportRegex(sport),
    date: { $gte: minDate, $lte: maxDate },
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
      date: { $gte: minDate, $lte: maxDate },
    }).populate('attendance.player', 'name age sport defaultParticipation');
  }
  return session;
}

