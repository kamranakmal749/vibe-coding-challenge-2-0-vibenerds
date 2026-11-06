// client/test/ist.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { istDateString, istToday, istYear, istDateTime, getWidenedDateWindow } from '../src/lib/ist';

test('ist.ts: date boundaries around 00:00 - 05:30 IST window', () => {
  // UTC 18:29:59 on Nov 6 = IST 23:59:59 on Nov 6 (just before midnight IST)
  const justBeforeMidnight = new Date('2026-11-06T18:29:59.000Z');
  assert.equal(istDateString(justBeforeMidnight), '2026-11-06');

  // UTC 18:30:00 on Nov 6 = IST 00:00:00 on Nov 7 (exact midnight IST)
  const exactMidnight = new Date('2026-11-06T18:30:00.000Z');
  assert.equal(istDateString(exactMidnight), '2026-11-07');

  // UTC 20:00:00 on Nov 6 = IST 01:30:00 on Nov 7 (early morning IST window)
  const earlyMorning = new Date('2026-11-06T20:00:00.000Z');
  assert.equal(istDateString(earlyMorning), '2026-11-07');

  // UTC 23:59:59 on Nov 6 = IST 05:29:59 on Nov 7 (end of UTC day, still early morning IST)
  const endOfUtcDay = new Date('2026-11-06T23:59:59.000Z');
  assert.equal(istDateString(endOfUtcDay), '2026-11-07');

  // UTC 00:00:00 on Nov 7 = IST 05:30:00 on Nov 7
  const utcMorning = new Date('2026-11-07T00:00:00.000Z');
  assert.equal(istDateString(utcMorning), '2026-11-07');
});

test('ist.ts: kickoff and unlock time calculations', () => {
  // Match scheduled at 16:00 IST on Nov 6
  const kickoff = istDateTime('2026-11-06', '16:00');
  // 16:00 IST is 10:30 UTC
  assert.equal(kickoff.toISOString(), '2026-11-06T10:30:00.000Z');
  assert.equal(istDateString(kickoff), '2026-11-06');

  // 60-minute unlock window after kickoff
  const unlockUntil = new Date(kickoff.getTime() + 60 * 60 * 1000);
  assert.equal(unlockUntil.toISOString(), '2026-11-06T11:30:00.000Z');
  assert.equal(istDateString(unlockUntil), '2026-11-06');

  // Match scheduled at 23:30 IST on Nov 6 -> unlock time crosses midnight IST into Nov 7
  const lateKickoff = istDateTime('2026-11-06', '23:30');
  assert.equal(lateKickoff.toISOString(), '2026-11-06T18:00:00.000Z');
  assert.equal(istDateString(lateKickoff), '2026-11-06');

  const lateUnlock = new Date(lateKickoff.getTime() + 60 * 60 * 1000); // 00:30 IST on Nov 7
  assert.equal(lateUnlock.toISOString(), '2026-11-06T19:00:00.000Z');
  assert.equal(istDateString(lateUnlock), '2026-11-07');
});

test('ist.ts: year rollover (Dec 31 to Jan 1)', () => {
  // UTC 18:29:59 on Dec 31, 2026 = IST 23:59:59 on Dec 31, 2026
  const endOfYear2026 = new Date('2026-12-31T18:29:59.000Z');
  assert.equal(istYear(endOfYear2026), 2026);
  assert.equal(istDateString(endOfYear2026), '2026-12-31');

  // UTC 18:30:00 on Dec 31, 2026 = IST 00:00:00 on Jan 1, 2027
  const startOfYear2027 = new Date('2026-12-31T18:30:00.000Z');
  assert.equal(istYear(startOfYear2027), 2027);
  assert.equal(istDateString(startOfYear2027), '2027-01-01');
});

test('ist.ts: widened date window covers IST day completely', () => {
  const { minDate, maxDate } = getWidenedDateWindow('2026-11-06');
  const istStart = istDateTime('2026-11-06', '00:00:00').getTime();
  const istEnd = istDateTime('2026-11-06', '23:59:59.999').getTime();

  assert.ok(minDate.getTime() <= istStart, 'minDate must cover IST day start');
  assert.ok(maxDate.getTime() >= istEnd, 'maxDate must cover IST day end');
});

