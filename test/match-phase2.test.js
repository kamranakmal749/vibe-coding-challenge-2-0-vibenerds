// test/match-phase2.test.js
// Unit & Integration tests for Phase 2: Match CRUD and calendar/list routes
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const User = require('../src/models/User');
const Match = require('../src/models/Match');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let server;
let baseUrl;
let coachUser;
let coachToken;

function authHeader(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  coachUser = await User.create({
    name: 'Phase 2 Coach',
    username: `p2coach_${Date.now()}`,
    email: `p2coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);
});

test.after(async () => {
  if (coachUser) {
    await Match.deleteMany({ coach: coachUser._id });
    await User.findByIdAndDelete(coachUser._id);
  }
  if (server) server.close();
  await mongoose.disconnect();
});

test('Phase 2: POST /api/matches creates a match and rejects missing fields & exact duplicates', async () => {
  // 1. Missing fields should return 400
  const badRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ title: 'Incomplete Match' })
  });
  assert.equal(badRes.status, 400);

  // 2. Successful creation
  const matchPayload = {
    title: 'Derby Cup Clash',
    sport: 'Football',
    date: '2026-07-15',
    time: '16:00',
    opponent: 'Titans FC',
    venue: 'City Arena',
    description: 'First leg'
  };

  const createRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify(matchPayload)
  });
  assert.equal(createRes.status, 201);
  const match = await createRes.json();
  assert.equal(match.status, 'upcoming');
  assert.equal(match.title, 'Derby Cup Clash');
  assert.equal(match.time, '16:00');

  // 3. Exact duplicate (coach, date, time, sport, opponent) returns 409
  const dupRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify(matchPayload)
  });
  assert.equal(dupRes.status, 409);
});

test('Phase 2: GET /api/matches with filters (sport, date, opponent, status)', async () => {
  // Seed two distinct matches
  await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'Cricket T20 League',
      sport: 'Cricket',
      date: '2026-07-18',
      time: '10:00',
      opponent: 'Strikers XI',
      venue: 'Cricket Oval'
    })
  });

  // Filter by sport=Cricket
  const cricketRes = await fetch(`${baseUrl}/api/matches?sport=Cricket`, {
    headers: authHeader(coachToken)
  });
  assert.equal(cricketRes.status, 200);
  const cricketMatches = await cricketRes.json();
  assert.ok(cricketMatches.length >= 1);
  assert.ok(cricketMatches.every(m => m.sport === 'Cricket'));

  // Filter by opponent regex
  const oppRes = await fetch(`${baseUrl}/api/matches?opponent=titans`, {
    headers: authHeader(coachToken)
  });
  assert.equal(oppRes.status, 200);
  const oppMatches = await oppRes.json();
  assert.ok(oppMatches.length >= 1);
  assert.ok(oppMatches.every(m => /titans/i.test(m.opponent)));

  // Filter by status=upcoming
  const statusRes = await fetch(`${baseUrl}/api/matches?status=upcoming`, {
    headers: authHeader(coachToken)
  });
  assert.equal(statusRes.status, 200);
  const statusMatches = await statusRes.json();
  assert.ok(statusMatches.every(m => m.status === 'upcoming'));
});

test('Phase 2: GET /api/matches/calendar returns only matches in requested month', async () => {
  // We already created matches in 2026-07
  const calRes = await fetch(`${baseUrl}/api/matches/calendar?month=2026-07`, {
    headers: authHeader(coachToken)
  });
  assert.equal(calRes.status, 200);
  const calMatches = await calRes.json();
  assert.ok(calMatches.length >= 2);
  assert.ok(calMatches.every(m => m.date.startsWith('2026-07')));

  // Check empty month
  const emptyRes = await fetch(`${baseUrl}/api/matches/calendar?month=2026-12`, {
    headers: authHeader(coachToken)
  });
  assert.equal(emptyRes.status, 200);
  const emptyMatches = await emptyRes.json();
  assert.equal(emptyMatches.length, 0);

  // Invalid month format returns 400
  const invalidRes = await fetch(`${baseUrl}/api/matches/calendar?month=invalid`, {
    headers: authHeader(coachToken)
  });
  assert.equal(invalidRes.status, 400);
});

test('Phase 2: GET /api/matches/:id returns details + computed counts, PATCH edits upcoming match, PATCH cancel works', async () => {
  const createRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'Patchable Match',
      sport: 'Football',
      date: '2026-08-01',
      time: '18:00',
      opponent: 'Rovers',
      venue: 'North Ground'
    })
  });
  const match = await createRes.json();

  // 1. GET /api/matches/:id returns computed counts
  const getRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    headers: authHeader(coachToken)
  });
  assert.equal(getRes.status, 200);
  const details = await getRes.json();
  assert.equal(details.title, 'Patchable Match');
  assert.equal(details.totalPlayed, 0);
  assert.equal(details.totalDidNotPlay, 0);
  assert.equal(details.totalEligiblePlayers, 0);

  // 2. PATCH /api/matches/:id edits fields while upcoming
  const patchRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'Updated Match Title',
      venue: 'Main Stadium 2'
    })
  });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.title, 'Updated Match Title');
  assert.equal(updated.venue, 'Main Stadium 2');

  // 3. PATCH /api/matches/:id/cancel cancels match
  const cancelRes = await fetch(`${baseUrl}/api/matches/${match._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(cancelRes.status, 200);
  const cancelled = await cancelRes.json();
  assert.equal(cancelled.match.status, 'cancelled');

  // 4. Editing a cancelled match should return 409
  const editCancelledRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ title: 'Try to edit cancelled' })
  });
  assert.equal(editCancelledRes.status, 409);
});

