// test/session-roster-integrity.test.js
// Regression test for the "retroactive roster injection" bug:
//   GET /api/sessions/:id was re-querying all players for the sport and injecting
//   newly-added players into an already-created session's attendance array.
//
// Correct behaviour: a session's attendance roster must be FIXED at the moment
// POST /api/sessions is called — it must never grow or shrink when new players
// are added to that sport after the session was created.

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');

const app     = require('../src/app');
const User    = require('../src/models/User');
const Player  = require('../src/models/Player');
const Session = require('../src/models/Session');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let server, baseUrl;
let coachUser, coachToken;
let p1, p2;

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  if (process.env.BASE_URL) {
    baseUrl = process.env.BASE_URL.replace(/\/$/, '');
  } else {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  }

  // Isolated coach with a unique sport name so nothing bleeds in from seeded data
  coachUser = await User.create({
    name: 'Roster Integrity Coach',
    username: `rostercoach_${Date.now()}`,
    email: `rostercoach_${Date.now()}@test-roster-integrity.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  // Create 2 players of a unique sport BEFORE the session
  p1 = await Player.create({
    name: 'RosterTest_PlayerA',
    age: 18, sport: 'RosterSport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });
  p2 = await Player.create({
    name: 'RosterTest_PlayerB',
    age: 20, sport: 'RosterSport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });
});

test.after(async () => {
  // Full teardown — remove all test data for this coach
  await Session.deleteMany({ coach: coachUser._id });
  await Player.deleteMany({ coach: coachUser._id });
  await User.findByIdAndDelete(coachUser._id);
  server.close();
  await mongoose.disconnect();
});

test('Session roster is fixed at creation time: adding a player AFTER session creation must NOT expand the roster', async () => {
  // 1. Open a session with 2 pre-existing players
  const createRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: '2027-01-15', sport: 'RosterSport' })
  });
  assert.equal(createRes.status, 201, 'Should create session successfully');
  const created = await createRes.json();
  assert.equal(created.attendance.length, 2, 'Session must be created with exactly 2 players (those who existed at creation time)');

  // 2. Add a third player to the same sport AFTER the session was opened
  const p3 = await Player.create({
    name: 'RosterTest_PlayerC_AddedAfter',
    age: 17, sport: 'RosterSport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });

  // 3. GET the session — the roster must still be 2, not 3
  const getRes = await fetch(`${baseUrl}/api/sessions/${created._id}`, {
    headers: authHeader(coachToken)
  });
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();

  // THE KEY ASSERTION: roster must remain at 2
  assert.equal(
    fetched.attendance.length,
    2,
    `Roster grew from 2 to ${fetched.attendance.length} after adding a new player — retroactive injection bug re-triggered`
  );

  // Confirm the third player's ID is NOT present in the roster
  const rosterIds = fetched.attendance.map(a => (a.player?._id || a.player).toString());
  assert.ok(
    !rosterIds.includes(p3._id.toString()),
    'The player added after session creation must not appear in the existing session roster'
  );

  // Cleanup p3 (before after() runs, just in case)
  await Player.findByIdAndDelete(p3._id);
});

test('Session GET on a locked session never re-queries players or modifies the stored roster', async () => {
  // Create a session with just 1 player
  const createRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: '2027-01-16', sport: 'RosterSport' })
  });
  assert.equal(createRes.status, 201);
  const session = await createRes.json();

  // Lock the session
  const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ attendance: session.attendance })
  });
  assert.equal(saveRes.status, 200, 'Should save/lock successfully');

  // Add another player after locking
  const pExtra = await Player.create({
    name: 'RosterTest_PostLockPlayer',
    age: 16, sport: 'RosterSport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });

  // GET the locked session — must still only have the original count
  const getRes = await fetch(`${baseUrl}/api/sessions/${session._id}`, {
    headers: authHeader(coachToken)
  });
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();

  const originalCount = session.attendance.length;
  assert.equal(
    fetched.attendance.length,
    originalCount,
    `Locked session roster changed from ${originalCount} to ${fetched.attendance.length} — should be immutable`
  );

  await Player.findByIdAndDelete(pExtra._id);
});

