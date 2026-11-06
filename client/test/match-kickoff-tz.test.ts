// client/test/match-kickoff-tz.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMatchScheduledDateTime,
  getMatchUnlockDateTime,
  getMatchTimeStatus
} from '../src/lib/clock';

test('MATCHES - Decision A: Kickoff, unlock, and status behavior under current TZ', () => {
  const match = {
    date: '2026-11-10',
    time: '17:00',
    status: 'upcoming'
  };

  const kickoff = getMatchScheduledDateTime(match);
  const unlock = getMatchUnlockDateTime(match);

  const kickoffIso = kickoff.toISOString();
  const unlockIso = unlock.toISOString();

  console.log(`\n--- TIMEZONE BEHAVIOR [TZ=${process.env.TZ || 'system'}] ---`);
  console.log(`Input Date:       ${match.date} ${match.time}`);
  console.log(`Kickoff Instant:  ${kickoffIso}`);
  console.log(`Unlock Instant:   ${unlockIso} (+60m)`);

  // Unlock must always be exactly kickoff + 60 minutes regardless of timezone
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

  console.log(`Time Status Checks: ALL PASSED (upcoming -> in_progress -> scoring_available)`);
});
