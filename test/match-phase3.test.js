// test/match-phase3.test.js
// Unit & Integration tests for Phase 3: Eligibility and player selection
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const User = require('../src/models/User');
const Player = require('../src/models/Player');
const Session = require('../src/models/Session');
const Match = require('../src/models/Match');
const MatchParticipation = require('../src/models/MatchParticipation');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let server;
let baseUrl;
let coachUser;
let coachToken;
let pPresentBoth;
let pPresentPractice;
let pAbsent;
let savedMatch;

function authHeader(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  coachUser = await User.create({
    name: 'Phase 3 Coach',
    username: `p3coach_${Date.now()}`,
    email: `p3coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  pPresentBoth = await Player.create({
    name: 'P3_EligiblePlayer',
    age: 20,
    sport: 'P3Sport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });

  pPresentPractice = await Player.create({
    name: 'P3_PracticeOnlyPlayer',
    age: 21,
    sport: 'P3Sport',
    defaultParticipation: 'practice',
    coach: coachUser._id
  });

  pAbsent = await Player.create({
    name: 'P3_AbsentPlayer',
    age: 22,
    sport: 'P3Sport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });
});

test.after(async () => {
  if (coachUser) {
    const userMatches = await Match.find({ coach: coachUser._id });
    const userMatchIds = userMatches.map(m => m._id);
    await MatchParticipation.deleteMany({ match: { $in: userMatchIds } });
    await Match.deleteMany({ coach: coachUser._id });
    await Session.deleteMany({ coach: coachUser._id });
    await Player.deleteMany({ coach: coachUser._id });
    await User.findByIdAndDelete(coachUser._id);
  }
  if (server) server.close();
  await mongoose.disconnect();
});

test('Phase 3: GET eligible-players returns sessionFound: false when no session or unsaved session', async () => {
  // 1. No session exists on date 2026-09-01
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'P3 Test Match 1',
      sport: 'P3Sport',
      date: '2026-09-01',
      time: '15:00',
      opponent: 'No Session FC',
      venue: 'Ground A'
    })
  });
  const match1 = await matchRes.json();

  const eligRes1 = await fetch(`${baseUrl}/api/matches/${match1._id}/eligible-players`, {
    headers: authHeader(coachToken)
  });
  assert.equal(eligRes1.status, 200);
  const eligData1 = await eligRes1.json();
  assert.equal(eligData1.sessionFound, false);
  assert.equal(eligData1.reason, undefined);

  // 2. Unsaved session exists on date 2026-09-02
  const session2 = await Session.create({
    date: new Date('2026-09-02'),
    sport: 'P3Sport',
    coach: coachUser._id,
    saved: false,
    locked: false,
    attendance: [
      { player: pPresentBoth._id, status: 'present', participation: 'both' }
    ]
  });

  const matchRes2 = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'P3 Test Match 2',
      sport: 'P3Sport',
      date: '2026-09-02',
      time: '15:00',
      opponent: 'Unsaved FC',
      venue: 'Ground B'
    })
  });
  const match2 = await matchRes2.json();

  const eligRes2 = await fetch(`${baseUrl}/api/matches/${match2._id}/eligible-players`, {
    headers: authHeader(coachToken)
  });
  assert.equal(eligRes2.status, 200);
  const eligData2 = await eligRes2.json();
  assert.equal(eligData2.sessionFound, false);
  assert.equal(eligData2.reason, 'not_saved');
});

test('Phase 3: GET eligible-players on saved session returns only present & match/both players', async () => {
  const matchDate = '2026-09-03';
  await Session.create({
    date: new Date(matchDate),
    sport: 'P3Sport',
    coach: coachUser._id,
    saved: true,
    savedAt: new Date(matchDate),
    locked: true,
    attendance: [
      { player: pPresentBoth._id, status: 'present', participation: 'both' },
      { player: pPresentPractice._id, status: 'present', participation: 'practice' },
      { player: pAbsent._id, status: 'absent', participation: null }
    ]
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'P3 Test Match 3',
      sport: 'P3Sport',
      date: matchDate,
      time: '15:00',
      opponent: 'Saved FC',
      venue: 'Ground C'
    })
  });
  savedMatch = await matchRes.json();
  const match = savedMatch;

  const eligRes = await fetch(`${baseUrl}/api/matches/${match._id}/eligible-players`, {
    headers: authHeader(coachToken)
  });
  assert.equal(eligRes.status, 200);
  const eligData = await eligRes.json();
  assert.equal(eligData.sessionFound, true);
  assert.equal(eligData.players.length, 1);
  assert.equal(eligData.players[0].playerId, pPresentBoth._id.toString());
  assert.equal(eligData.players[0].attendanceStatus, 'present');
});

test('Phase 3: PUT selected-players rejects non-eligible player with 422', async () => {
  const match = savedMatch;

  // Try selecting absent player
  const selectBadRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerIds: [pAbsent._id.toString()]
    })
  });
  assert.equal(selectBadRes.status, 422);
  const badData = await selectBadRes.json();
  assert.ok(badData.invalidPlayerIds.includes(pAbsent._id.toString()));

  // Try selecting practice-only player
  const selectPracticeRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerIds: [pPresentPractice._id.toString()]
    })
  });
  assert.equal(selectPracticeRes.status, 422);
  const practiceData = await selectPracticeRes.json();
  assert.ok(practiceData.invalidPlayerIds.includes(pPresentPractice._id.toString()));
});

test('Phase 3: PUT selected-players succeeds, is idempotent, and removing a player removes participation row', async () => {
  const match = savedMatch;

  // 1. Select eligible player
  const selRes1 = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerIds: [pPresentBoth._id.toString()]
    })
  });
  assert.equal(selRes1.status, 200);
  const selData1 = await selRes1.json();
  assert.equal(selData1.selectedCount, 1);

  // Check MatchParticipation row was created
  let parts = await MatchParticipation.find({ match: match._id });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].player.toString(), pPresentBoth._id.toString());
  assert.equal(parts[0].played, null);

  // 2. Idempotency test: Call PUT with same list again, no duplicates or error
  const selRes2 = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerIds: [pPresentBoth._id.toString()]
    })
  });
  assert.equal(selRes2.status, 200);
  parts = await MatchParticipation.find({ match: match._id });
  assert.equal(parts.length, 1);

  // 3. Deselect player pre-completion: update with empty list []
  const selRes3 = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerIds: []
    })
  });
  assert.equal(selRes3.status, 200);
  parts = await MatchParticipation.find({ match: match._id });
  assert.equal(parts.length, 0);
});

