// client/test/sessions.parity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const User = require('../src/lib/models/User');
const Player = require('../src/lib/models/Player');
const Session = require('../src/lib/models/Session');

function authHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(parityUri);
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

test('SESSIONS - Lifecycle, role matrix, guards, atomic save, lock/unlock & sync bumps', async () => {
  const ts = Date.now();
  // 1. Create Coach A, Coach B, Scout, Player, Admin
  const coachA = await User.create({
    name: 'Session Coach A',
    username: `coach_sess_a_${ts}`,
    email: `coach_sess_a_${ts}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const tokenA = jwt.sign({ id: coachA._id, role: 'coach' }, JWT_SECRET);

  const coachB = await User.create({
    name: 'Session Coach B',
    username: `coach_sess_b_${ts}`,
    email: `coach_sess_b_${ts}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const tokenB = jwt.sign({ id: coachB._id, role: 'coach' }, JWT_SECRET);

  const scout = await User.create({
    name: 'Session Scout',
    username: `scout_sess_${ts}`,
    email: `scout_sess_${ts}@test.com`,
    password: 'password123',
    role: 'scout'
  });
  const tokenScout = jwt.sign({ id: scout._id, role: 'scout' }, JWT_SECRET);

  const playerOne = await Player.create({
    name: 'Roster Player 1',
    sport: 'Football',
    age: 18,
    coach: coachA._id,
    defaultParticipation: 'both'
  });

  const playerTwo = await Player.create({
    name: 'Roster Player 2',
    sport: 'Football',
    age: 19,
    coach: coachA._id,
    defaultParticipation: 'practice'
  });

  const playerUser = await User.create({
    name: playerOne.name,
    username: `puser_${playerOne._id}`,
    email: `puser_${playerOne._id}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: playerOne._id
  });
  const tokenPlayer = jwt.sign({ id: playerUser._id, role: 'player', playerId: playerOne._id }, JWT_SECRET);

  // ── 2. ROLE MATRIX ON POST /api/sessions ──
  // Player cannot open session -> 403
  const pSessRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenPlayer),
    body: JSON.stringify({ date: '2026-11-01', sport: 'Football' })
  });
  assert.equal(pSessRes.status, 403);

  // Scout cannot open session -> 403
  const scSessRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenScout),
    body: JSON.stringify({ date: '2026-11-01', sport: 'Football' })
  });
  assert.equal(scSessRes.status, 403);

  // Missing token -> 401
  const noTokenRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-11-01', sport: 'Football' })
  });
  assert.equal(noTokenRes.status, 401);

  // ── 3. FUTURE DATE VALIDATION ON POST /api/sessions ──
  const futureRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({ date: '2027-12-31', sport: 'Football' })
  });
  assert.equal(futureRes.status, 400);
  const futureData = await futureRes.json();
  assert.equal(
    futureData.error,
    'Cannot create attendance sessions for future dates. Please select today or a past date.'
  );

  // ── 4. CREATE DRAFT SESSION (Coach A) ──
  const pastDateStr = '2026-10-20';
  const createRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({ date: pastDateStr, sport: 'Football' })
  });
  assert.equal(createRes.status, 201);
  const session = await createRes.json();
  assert.ok(session._id);
  assert.equal(session.saved, false);
  assert.equal(session.locked, false);
  assert.equal(session.initialRosterPlayerIds.length, 2);

  // ── 5. DUPLICATE SESSION ON SAME DATE AND SPORT -> 409 ──
  const dupRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({ date: pastDateStr, sport: 'Football' })
  });
  assert.equal(dupRes.status, 409);
  const dupData = await dupRes.json();
  assert.equal(dupData.error, 'A session already exists for this coach, date, and sport');

  // ── 6. GET /api/sessions/:id ROLE VISIBILITY ──
  // Coach B cannot view Coach A's draft session -> 403
  const crossGet = await fetch(`${baseUrl}/api/sessions/${session._id}`, {
    headers: authHeader(tokenB)
  });
  assert.equal(crossGet.status, 403);

  // Player cannot view unsaved draft session -> 403
  const playerDraftGet = await fetch(`${baseUrl}/api/sessions/${session._id}`, {
    headers: authHeader(tokenPlayer)
  });
  assert.equal(playerDraftGet.status, 403);

  // Coach A views own draft session -> 200
  const coachGet = await fetch(`${baseUrl}/api/sessions/${session._id}`, {
    headers: authHeader(tokenA)
  });
  assert.equal(coachGet.status, 200);

  // ── 7. BULK ATTENDANCE (PATCH /api/sessions/:id/bulk) ──
  const bulkRes = await fetch(`${baseUrl}/api/sessions/${session._id}/bulk`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({
      attendance: [
        { playerId: playerOne._id, status: 'present', participation: 'both' },
        { playerId: playerTwo._id, status: 'present', participation: 'practice' }
      ]
    })
  });
  assert.equal(bulkRes.status, 200);

  // ── 8. MARK ATTENDANCE (PATCH /api/sessions/:id/mark) ──
  // Coach B cannot mark Coach A's session -> 403
  const crossMark = await fetch(`${baseUrl}/api/sessions/${session._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ playerId: playerOne._id, status: 'absent' })
  });
  assert.equal(crossMark.status, 403);

  // Mark playerOne absent -> participation becomes null
  const markRes = await fetch(`${baseUrl}/api/sessions/${session._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({ playerId: playerOne._id, status: 'absent' })
  });
  assert.equal(markRes.status, 200);
  const markData = await markRes.json();
  assert.equal(markData.entry.status, 'absent');
  assert.equal(markData.entry.participation, null);

  // ── 9. ATOMIC SAVE ATTENDANCE (PATCH /api/sessions/:id/save) ──
  const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({
      attendance: [
        { playerId: playerOne._id, status: 'present', participation: 'match' },
        { playerId: playerTwo._id, status: 'absent' }
      ]
    })
  });
  assert.equal(saveRes.status, 200);
  const saveData = await saveRes.json();
  assert.equal(saveData.session.saved, true);
  assert.equal(saveData.session.locked, true);

  // ── 10. RE-SAVING A LOCKED/SAVED SESSION -> 409 ──
  const reSaveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({ attendance: [] })
  });
  assert.equal(reSaveRes.status, 409);
  const reSaveData = await reSaveRes.json();
  assert.equal(
    reSaveData.error,
    'Attendance is saved and session is locked. Unlock the session to edit and save attendance.'
  );

  // Marking in locked session -> 409
  const lockedMarkRes = await fetch(`${baseUrl}/api/sessions/${session._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({ playerId: playerOne._id, status: 'present' })
  });
  assert.equal(lockedMarkRes.status, 409);

  // ── 11. UNLOCK SESSION (PATCH /api/sessions/:id/unlock) ──
  const unlockRes = await fetch(`${baseUrl}/api/sessions/${session._id}/unlock`, {
    method: 'PATCH',
    headers: authHeader(tokenA)
  });
  assert.equal(unlockRes.status, 200);
  const unlockData = await unlockRes.json();
  assert.equal(unlockData.session.locked, false);
  assert.equal(unlockData.session.saved, true, 'saved must stay true upon unlock');

  // ── 12. TOGGLE-LOCK SESSION (PATCH /api/sessions/:id/toggle-lock) ──
  const toggleRes = await fetch(`${baseUrl}/api/sessions/${session._id}/toggle-lock`, {
    method: 'PATCH',
    headers: authHeader(tokenA)
  });
  assert.equal(toggleRes.status, 200);
  const toggleData = await toggleRes.json();
  assert.equal(toggleData.locked, true);

  // ── Cleanup ──
  await Session.findByIdAndDelete(session._id);
  await Player.deleteMany({ _id: { $in: [playerOne._id, playerTwo._id] } });
  await User.deleteMany({ _id: { $in: [coachA._id, coachB._id, scout._id, playerUser._id] } });
});

test('SESSIONS - Concurrent save race condition returns 409 for second caller', async () => {
  const ts = Date.now();
  const coach = await User.create({
    name: 'Race Coach',
    username: `coach_race_${ts}`,
    email: `coach_race_${ts}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const token = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);

  const player = await Player.create({
    name: 'Race Player',
    sport: 'Football',
    age: 17,
    coach: coach._id
  });

  const session = await Session.create({
    coach: coach._id,
    sport: 'Football',
    date: new Date('2026-10-15T00:00:00.000Z'),
    saved: false,
    locked: false,
    attendance: [{ player: player._id, status: 'present', participation: 'both' }],
    initialRosterPlayerIds: [player._id]
  });

  // Launch two concurrent save requests
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({
        attendance: [{ playerId: player._id, status: 'present', participation: 'both' }]
      })
    }),
    fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({
        attendance: [{ playerId: player._id, status: 'present', participation: 'both' }]
      })
    })
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one concurrent save must succeed (200) and one must be rejected (409)');

  // Cleanup
  await Session.findByIdAndDelete(session._id);
  await Player.findByIdAndDelete(player._id);
  await User.findByIdAndDelete(coach._id);
});

