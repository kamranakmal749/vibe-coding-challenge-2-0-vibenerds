// client/test/match-kickoff-tz.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMatchScheduledDateTime,
  getMatchUnlockDateTime,
  getMatchTimeStatus
} from '../src/lib/clock';

test('MATCHES - Decision A: Kickoff, unlock, and status assertion under TZ', () => {
  const match = {
    date: '2026-11-10',
    time: '17:00',
    status: 'upcoming'
  };

  const kickoff = getMatchScheduledDateTime(match);
  const unlock = getMatchUnlockDateTime(match);

  const kickoffIso = kickoff.toISOString();
  const unlockIso = unlock.toISOString();

  console.log(`[TZ=${process.env.TZ || 'system'}] Kickoff: ${kickoffIso} | Unlock: ${unlockIso}`);

  // Strict assertions mandated by Decision A (closed)
  assert.equal(kickoffIso, '2026-11-10T11:30:00.000Z', 'Kickoff must be exactly 11:30:00.000Z');
  assert.equal(unlockIso, '2026-11-10T12:30:00.000Z', 'Unlock must be exactly 12:30:00.000Z');

  // Also test with Date object inputs (both UTC midnight and IST afternoon as stored in MongoDB)
  const matchWithUtcMidnightDate = {
    date: new Date('2026-11-10T00:00:00.000Z'),
    time: '17:00'
  };
  assert.equal(
    getMatchScheduledDateTime(matchWithUtcMidnightDate).toISOString(),
    '2026-11-10T11:30:00.000Z'
  );
  assert.equal(
    getMatchUnlockDateTime(matchWithUtcMidnightDate).toISOString(),
    '2026-11-10T12:30:00.000Z'
  );

  const matchWithSeedDate = {
    date: new Date('2026-11-10T10:00:00.000Z'), // 15:30 IST
    time: '17:00'
  };
  assert.equal(
    getMatchScheduledDateTime(matchWithSeedDate).toISOString(),
    '2026-11-10T11:30:00.000Z'
  );
  assert.equal(
    getMatchUnlockDateTime(matchWithSeedDate).toISOString(),
    '2026-11-10T12:30:00.000Z'
  );

  // Unlock must always be exactly kickoff + 60 minutes
  const diffMs = unlock.getTime() - kickoff.getTime();
  assert.equal(diffMs, 60 * 60 * 1000, 'Unlock time must be exactly 60 minutes after kickoff');

  // Verify time status progression:
  // Before kickoff -> upcoming
  const beforeKickoff = new Date(kickoff.getTime() - 5 * 60 * 1000);
  assert.equal(getMatchTimeStatus(match, beforeKickoff), 'upcoming');

  // Between kickoff and unlock -> in_progress
  const duringMatch = new Date(kickoff.getTime() + 30 * 60 * 1000);
  assert.equal(getMatchTimeStatus(match, duringMatch), 'in_progress');

  // After unlock -> scoring_available
  const afterUnlock = new Date(unlock.getTime() + 5 * 60 * 1000);
  assert.equal(getMatchTimeStatus(match, afterUnlock), 'scoring_available');
});
