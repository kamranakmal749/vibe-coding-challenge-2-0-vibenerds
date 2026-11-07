// test/match-phase6.test.js
// Unit & Integration tests for Phase 6: Ready status integration
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
let readyPlayer;

function authHeader(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  if (process.env.BASE_URL) {
    baseUrl = process.env.BASE_URL.replace(/\/$/, '');
  } else {
    server = app.listen(0);
    baseUrl = `http://localhost:${server.address().port}`;
  }

  coachUser = await User.create({
    name: 'Phase 6 Coach',
    username: `p6coach_${Date.now()}`,
    email: `p6coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  readyPlayer = await Player.create({
    name: 'P6 Candidate Athlete',
    age: 20,
    sport: 'P6Sport',
    coach: coachUser._id
  });

  // Setup attendance: 4 saved sessions, present in 3 = 75% attendance
  for (let i = 1; i <= 4; i++) {
    const d = new Date(`2026-11-0${i}`);
    await Session.create({
      date: d,
      sport: 'P6Sport',
      coach: coachUser._id,
      saved: true,
      savedAt: d,
      locked: true,
      attendance: [
        { player: readyPlayer._id, status: i <= 3 ? 'present' : 'absent', participation: i <= 3 ? 'both' : null }
      ]
    });
  }
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

test('Phase 6: Player with 75% attendance and 2 completed played matches is Ready; upcoming or not-played matches do not count', async () => {
  // 1. Initial State: 75% attendance, 0 matches -> NOT READY
  let pRes = await fetch(`${baseUrl}/api/players/${readyPlayer._id}`, { headers: authHeader(coachToken) });
  let pData = await pRes.json();
  assert.equal(pData.attendanceRate, 75);
  assert.equal(pData.totalMatchesPlayed, 0);
  assert.equal(pData.isReady, false);

  // 2. Add 1 completed match with played: true -> totalMatchesPlayed = 1 -> NOT READY (needs >= 2)
  const m1 = await Match.create({
    title: 'P6 Match 1',
    sport: 'P6Sport',
    date: new Date('2026-11-01'),
    time: '14:00',
    opponent: 'Team Alpha',
    venue: 'Ground 1',
    status: 'completed',
    coach: coachUser._id,
    selectedPlayers: [readyPlayer._id]
  });
  await MatchParticipation.create({
    match: m1._id,
    player: readyPlayer._id,
    played: true,
    score: 2
  });

  pRes = await fetch(`${baseUrl}/api/players/${readyPlayer._id}`, { headers: authHeader(coachToken) });
  pData = await pRes.json();
  assert.equal(pData.totalMatchesPlayed, 1);
  assert.equal(pData.isReady, false, '75% attendance and 1 match must be NOT READY');

  // 3. Add second match but with status: "upcoming" and played: true -> totalMatchesPlayed remains 1 -> NOT READY
  const m2Upcoming = await Match.create({
    title: 'P6 Match 2 Upcoming',
    sport: 'P6Sport',
    date: new Date('2026-11-02'),
    time: '14:00',
    opponent: 'Team Beta',
    venue: 'Ground 2',
    status: 'upcoming',
    coach: coachUser._id,
    selectedPlayers: [readyPlayer._id]
  });
  await MatchParticipation.create({
    match: m2Upcoming._id,
    player: readyPlayer._id,
    played: true,
    score: 1
  });

  pRes = await fetch(`${baseUrl}/api/players/${readyPlayer._id}`, { headers: authHeader(coachToken) });
  pData = await pRes.json();
  assert.equal(pData.totalMatchesPlayed, 1, 'Upcoming matches must not count toward totalMatchesPlayed');
  assert.equal(pData.isReady, false, 'Player with 1 completed match and 1 upcoming match is NOT READY');

  // 4. Add a completed match where played: false -> does NOT count toward totalMatchesPlayed -> NOT READY
  const m3NotPlayed = await Match.create({
    title: 'P6 Match 3 Benched',
    sport: 'P6Sport',
    date: new Date('2026-11-03'),
    time: '14:00',
    opponent: 'Team Gamma',
    venue: 'Ground 3',
    status: 'completed',
    coach: coachUser._id,
    selectedPlayers: [readyPlayer._id]
  });
  await MatchParticipation.create({
    match: m3NotPlayed._id,
    player: readyPlayer._id,
    played: false,
    score: null
  });

  pRes = await fetch(`${baseUrl}/api/players/${readyPlayer._id}`, { headers: authHeader(coachToken) });
  pData = await pRes.json();
  assert.equal(pData.totalMatchesPlayed, 1, 'played: false on completed match must not count');
  assert.equal(pData.totalMatchesNotPlayed, 1);
  assert.equal(pData.isReady, false);

  // 5. Complete the second match m2Upcoming (transition status to 'completed') -> totalMatchesPlayed = 2 -> READY
  m2Upcoming.status = 'completed';
  await m2Upcoming.save();

  pRes = await fetch(`${baseUrl}/api/players/${readyPlayer._id}`, { headers: authHeader(coachToken) });
  pData = await pRes.json();
  assert.equal(pData.totalMatchesPlayed, 2);
  assert.equal(pData.isReady, true, '75% attendance and 2 completed played matches must be READY');

  // 6. Verify Scout Radar (GET /api/scout/ready) includes this player now that they are READY
  const scoutUser = await User.create({
    name: 'P6 Scout',
    username: `p6scout_${Date.now()}`,
    email: `p6scout_${Date.now()}@test.com`,
    password: 'password123',
    role: 'scout'
  });
  const scoutToken = jwt.sign({ id: scoutUser._id, role: 'scout' }, JWT_SECRET);

  const scoutRes = await fetch(`${baseUrl}/api/scout/ready`, { headers: authHeader(scoutToken) });
  assert.equal(scoutRes.status, 200);
  const scoutReadyList = await scoutRes.json();
  assert.ok(scoutReadyList.some(p => p._id.toString() === readyPlayer._id.toString()));

  await User.findByIdAndDelete(scoutUser._id);
});

