// test/match-phase4.test.js
// Unit & Integration tests for Phase 4: Participation, scoring, and completing the match
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
let player1;
let player2;
let testMatch;

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
    name: 'Phase 4 Coach',
    username: `p4coach_${Date.now()}`,
    email: `p4coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  player1 = await Player.create({
    name: 'P4 Player 1',
    age: 20,
    sport: 'Football',
    defaultParticipation: 'both',
    coach: coachUser._id
  });

  player2 = await Player.create({
    name: 'P4 Player 2',
    age: 21,
    sport: 'Football',
    defaultParticipation: 'both',
    coach: coachUser._id
  });

  // Saved session for eligibility
  const matchDate = '2026-10-01';
  const session = await Session.create({
    date: new Date(matchDate),
    sport: 'Football',
    coach: coachUser._id,
    saved: true,
    savedAt: new Date(matchDate),
    locked: true,
    attendance: [
      { player: player1._id, status: 'present', participation: 'both' },
      { player: player2._id, status: 'present', participation: 'both' }
    ]
  });

  // Match
  testMatch = await Match.create({
    title: 'Phase 4 Match',
    sport: 'Football',
    date: new Date(matchDate),
    time: '16:00',
    opponent: 'Phase 4 Opponent',
    venue: 'Ground P4',
    coach: coachUser._id,
    sessionId: session._id,
    selectedPlayers: [player1._id, player2._id]
  });

  // Initialize selected players via PUT endpoint
  await fetch(`${baseUrl}/api/matches/${testMatch._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerIds: [player1._id.toString(), player2._id.toString()]
    })
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

test('Phase 4: GET /api/matches/:id/participation returns participation table', async () => {
  const res = await fetch(`${baseUrl}/api/matches/${testMatch._id}/participation`, {
    headers: authHeader(coachToken)
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.participations.length, 2);
  assert.ok(data.participations.every(p => p.played === null));
});

test('Phase 4: PATCH /api/matches/:id/participation/:playerId enforces played:false forces score:null, and played:true requires score for numeric sport', async () => {
  // 1. played: false forces score: null even if score is passed
  const p1Res = await fetch(`${baseUrl}/api/matches/${testMatch._id}/participation/${player1._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      played: false,
      score: 10,
      remarks: 'Benched'
    })
  });
  assert.equal(p1Res.status, 200);
  const p1Data = await p1Res.json();
  assert.equal(p1Data.participation.played, false);
  assert.equal(p1Data.participation.score, null);
  assert.equal(p1Data.participation.remarks, 'Benched');

  // Verify in DB directly
  const p1Db = await MatchParticipation.findOne({ match: testMatch._id, player: player1._id });
  assert.equal(p1Db.score, null);
  assert.equal(p1Db.played, false);

  // 2. played: true with missing score for Football (numeric sport) returns 400
  const badScoreRes = await fetch(`${baseUrl}/api/matches/${testMatch._id}/participation/${player2._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      played: true
    })
  });
  assert.equal(badScoreRes.status, 400);

  // 3. played: true with score >= 0 succeeds
  const goodScoreRes = await fetch(`${baseUrl}/api/matches/${testMatch._id}/participation/${player2._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      played: true,
      score: 3,
      remarks: 'Hat trick'
    })
  });
  assert.equal(goodScoreRes.status, 200);
  const goodData = await goodScoreRes.json();
  assert.equal(goodData.participation.played, true);
  assert.equal(goodData.participation.score, 3);
});

test('Phase 4: PATCH /api/matches/:id/complete validates all selected players have played status, then marks completed', async () => {
  // Reset player2 to null to test incomplete status rejection
  await MatchParticipation.findOneAndUpdate(
    { match: testMatch._id, player: player2._id },
    { played: null }
  );

  // 1. Completing with a missing status is rejected with 422 and lists missing player ID
  const failCompleteRes = await fetch(`${baseUrl}/api/matches/${testMatch._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(failCompleteRes.status, 422);
  const failData = await failCompleteRes.json();
  assert.ok(failData.missingStatusPlayerIds.includes(player2._id.toString()));

  // 2. Set player2 played to true with score
  await fetch(`${baseUrl}/api/matches/${testMatch._id}/participation/${player2._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      played: true,
      score: 1
    })
  });

  // 3. Completing now succeeds
  const successCompleteRes = await fetch(`${baseUrl}/api/matches/${testMatch._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(successCompleteRes.status, 200);
  const successData = await successCompleteRes.json();
  assert.equal(successData.match.status, 'completed');

  // Verify in DB
  const completedMatch = await Match.findById(testMatch._id);
  assert.equal(completedMatch.status, 'completed');

  // 4. Editing completed match without Phase 5 unlock returns 409
  const editCompletedRes = await fetch(`${baseUrl}/api/matches/${testMatch._id}/participation/${player1._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 0 })
  });
  assert.equal(editCompletedRes.status, 409);
});

