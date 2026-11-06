// test/match-phase5.test.js
// Unit & Integration tests for Phase 5: Reopening completed matches, history, and player stats
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
let playerA;
let playerB;
let completedMatch;
let lockedMatch;

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
    name: 'Phase 5 Coach',
    username: `p5coach_${Date.now()}`,
    email: `p5coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  playerA = await Player.create({
    name: 'P5 Athlete A',
    age: 20,
    sport: 'Football',
    coach: coachUser._id
  });

  playerB = await Player.create({
    name: 'P5 Athlete B',
    age: 21,
    sport: 'Football',
    coach: coachUser._id
  });

  // Completed Match 1
  completedMatch = await Match.create({
    title: 'P5 Final Match',
    sport: 'Football',
    date: new Date('2026-10-10'),
    time: '14:00',
    opponent: 'Alpha Rovers',
    venue: 'Alpha Arena',
    status: 'completed',
    coach: coachUser._id,
    selectedPlayers: [playerA._id, playerB._id]
  });

  await MatchParticipation.create({
    match: completedMatch._id,
    player: playerA._id,
    played: true,
    score: 2,
    remarks: 'Great goals'
  });

  await MatchParticipation.create({
    match: completedMatch._id,
    player: playerB._id,
    played: false,
    score: null,
    remarks: 'Substitute'
  });

  // Another unrelated completed match to verify it remains locked
  lockedMatch = await Match.create({
    title: 'P5 Locked Match',
    sport: 'Football',
    date: new Date('2026-10-12'),
    time: '15:00',
    opponent: 'Beta Tigers',
    venue: 'Beta Stadium',
    status: 'completed',
    coach: coachUser._id,
    selectedPlayers: [playerA._id]
  });

  await MatchParticipation.create({
    match: lockedMatch._id,
    player: playerA._id,
    played: true,
    score: 1
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

test('Phase 5: Reopening completed match unlocks participation edits, while unrelated completed match stays locked', async () => {
  // 1. Without reopen: editing completedMatch returns 409
  const editLockedRes = await fetch(`${baseUrl}/api/matches/${completedMatch._id}/participation/${playerA._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 3 })
  });
  assert.equal(editLockedRes.status, 409);

  // 2. Call PATCH /api/matches/:id/reopen-for-edit
  const reopenRes = await fetch(`${baseUrl}/api/matches/${completedMatch._id}/reopen-for-edit`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(reopenRes.status, 200);
  const reopenData = await reopenRes.json();
  assert.equal(reopenData.status, 'completed'); // Status remains 'completed'
  assert.ok(new Date(reopenData.editUnlockedUntil).getTime() > Date.now());

  // 3. Editing completedMatch now succeeds
  const editAllowedRes = await fetch(`${baseUrl}/api/matches/${completedMatch._id}/participation/${playerA._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 4, remarks: 'Updated score' })
  });
  assert.equal(editAllowedRes.status, 200);
  const updatedPart = await editAllowedRes.json();
  assert.equal(updatedPart.participation.score, 4);

  // 4. Verify unrelated completed match (lockedMatch) stays locked (409)
  const unrelatedEditRes = await fetch(`${baseUrl}/api/matches/${lockedMatch._id}/participation/${playerA._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 5 })
  });
  assert.equal(unrelatedEditRes.status, 409);
});

test('Phase 5: GET /api/matches/history returns only completed matches with totalPlayed count and filters', async () => {
  // Add an upcoming match to verify it is excluded from history
  await Match.create({
    title: 'Upcoming Match',
    sport: 'Football',
    date: new Date('2026-10-20'),
    time: '18:00',
    opponent: 'Gamma Lions',
    venue: 'Gamma Pitch',
    status: 'upcoming',
    coach: coachUser._id
  });

  const historyRes = await fetch(`${baseUrl}/api/matches/history`, {
    headers: authHeader(coachToken)
  });
  assert.equal(historyRes.status, 200);
  const history = await historyRes.json();

  // All matches in history must be 'completed'
  assert.ok(history.length >= 2);
  assert.ok(history.every(m => m.status === 'completed'));

  // completedMatch has 1 player who played (playerA)
  const found = history.find(m => m._id === completedMatch._id.toString());
  assert.ok(found);
  assert.equal(found.totalPlayed, 1);

  // Filter by opponent regex
  const filterRes = await fetch(`${baseUrl}/api/matches/history?opponent=alpha`, {
    headers: authHeader(coachToken)
  });
  assert.equal(filterRes.status, 200);
  const filtered = await filterRes.json();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].opponent, 'Alpha Rovers');
});

test('Phase 5: Player stats (totalMatchesPlayed, totalMatchesSelected, totalMatchesNotPlayed, individual history) exclude upcoming and cancelled matches', async () => {
  // Create an upcoming match selecting playerA
  const upcomingMatch = await Match.create({
    title: 'Upcoming for Player A',
    sport: 'Football',
    date: new Date('2026-11-01'),
    time: '10:00',
    opponent: 'Next Opponent',
    venue: 'Future Stadium',
    status: 'upcoming',
    coach: coachUser._id,
    selectedPlayers: [playerA._id]
  });
  await MatchParticipation.create({
    match: upcomingMatch._id,
    player: playerA._id,
    played: true,
    score: 5
  });

  // Create a cancelled match selecting playerA
  const cancelledMatch = await Match.create({
    title: 'Cancelled Match',
    sport: 'Football',
    date: new Date('2026-11-02'),
    time: '10:00',
    opponent: 'Cancelled Opponent',
    venue: 'Future Stadium',
    status: 'cancelled',
    coach: coachUser._id,
    selectedPlayers: [playerA._id]
  });
  await MatchParticipation.create({
    match: cancelledMatch._id,
    player: playerA._id,
    played: true,
    score: 3
  });

  // Fetch playerA profile
  const pRes = await fetch(`${baseUrl}/api/players/${playerA._id}`, {
    headers: authHeader(coachToken)
  });
  assert.equal(pRes.status, 200);
  const pData = await pRes.json();

  // Player A participated in:
  // 1. completedMatch: completed, played === true -> counts towards totalMatchesPlayed
  // 2. lockedMatch: completed, played === true -> counts towards totalMatchesPlayed
  // 3. upcomingMatch: upcoming, played === true -> MUST BE EXCLUDED from totalMatchesPlayed
  // 4. cancelledMatch: cancelled, played === true -> MUST BE EXCLUDED from totalMatchesPlayed
  assert.equal(pData.totalMatchesPlayed, 2, 'Upcoming and cancelled matches must be excluded from totalMatchesPlayed');
  assert.equal(pData.totalMatchesNotPlayed, 0);

  // Match history list on player profile should only contain completed matches
  assert.ok(pData.matchHistory.length >= 2);
  assert.ok(pData.matchHistory.every(m => m.matchId.toString() !== upcomingMatch._id.toString() && m.matchId.toString() !== cancelledMatch._id.toString()));

  // Fetch playerB profile: was selected in completedMatch with played: false
  const pBRes = await fetch(`${baseUrl}/api/players/${playerB._id}`, {
    headers: authHeader(coachToken)
  });
  assert.equal(pBRes.status, 200);
  const pBData = await pBRes.json();
  assert.equal(pBData.totalMatchesPlayed, 0);
  assert.equal(pBData.totalMatchesNotPlayed, 1);
});

