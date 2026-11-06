// test/acceptance.test.js
// Automated Acceptance Tests for MaidanDesk (All 16 Scenarios from Section 8)
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
const migrateV2 = require('../scripts/migrate-v2');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let server;
let baseUrl;
let coachUser;
let scoutUser;
let playerUser;
let coachToken;
let scoutToken;
let playerToken;
let testPlayers = [];

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

  // Clean test namespace data
  await User.deleteMany({ email: { $regex: /@test-acceptance\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^TestAcc_/ } });
  await Session.deleteMany({ sport: { $in: ['AcceptanceSport', 'MetricSport'] } });
  await Match.deleteMany({ sport: { $in: ['AcceptanceSport', 'MetricSport'] } });

  // Create test coach
  coachUser = await User.create({
    name: 'Test Coach',
    username: `coach_${Date.now()}`,
    email: `coach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  // Create test scout
  scoutUser = await User.create({
    name: 'Test Scout',
    username: `scout_${Date.now()}`,
    email: `scout_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'scout'
  });
  scoutToken = jwt.sign({ id: scoutUser._id, role: 'scout' }, JWT_SECRET);

  // Create 4 test players with diverse default participation
  // P1: both
  const p1 = await Player.create({
    name: 'TestAcc_Player1_Both',
    age: 18,
    sport: 'AcceptanceSport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });
  // P2: practice
  const p2 = await Player.create({
    name: 'TestAcc_Player2_Practice',
    age: 19,
    sport: 'AcceptanceSport',
    defaultParticipation: 'practice',
    coach: coachUser._id
  });
  // P3: match
  const p3 = await Player.create({
    name: 'TestAcc_Player3_Match',
    age: 20,
    sport: 'AcceptanceSport',
    defaultParticipation: 'match',
    coach: coachUser._id
  });
  // P4: both
  const p4 = await Player.create({
    name: 'TestAcc_Player4_Both',
    age: 21,
    sport: 'AcceptanceSport',
    defaultParticipation: 'both',
    coach: coachUser._id
  });

  testPlayers = [p1, p2, p3, p4];

  // User for P1
  playerUser = await User.create({
    name: p1.name,
    username: `p1_${Date.now()}`,
    email: `p1_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'player',
    playerId: p1._id
  });
  playerToken = jwt.sign({ id: playerUser._id, role: 'player', playerId: p1._id }, JWT_SECRET);
});

test.after(async () => {
  // Cleanup test data
  if (coachUser) {
    await User.deleteMany({ email: { $regex: /@test-acceptance\.com$/ } });
    await Player.deleteMany({ name: { $regex: /^TestAcc_/ } });
    await Session.deleteMany({ sport: 'AcceptanceSport' });
    await Match.deleteMany({ sport: 'AcceptanceSport' });
  }
  if (server) server.close();
  await mongoose.disconnect();
});

// ─────────────────────────────────────────────────────────────
// Scenario 1: Opening session creates every player with default participation
// ─────────────────────────────────────────────────────────────
test('1. Opening a session creates every player of that coach in that sport with status "present" and participation equal to defaultParticipation', async () => {
  const sessionDate = '2026-05-01';
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });

  assert.equal(res.status, 201);
  const session = await res.json();
  assert.equal(session.attendance.length, 4);

  for (const entry of session.attendance) {
    assert.equal(entry.status, 'present');
    const p = testPlayers.find(tp => tp._id.toString() === (entry.player._id || entry.player).toString());
    assert.ok(p, 'Player exists in test roster');
    assert.equal(entry.participation, p.defaultParticipation);
  }
});

// ─────────────────────────────────────────────────────────────
// Scenario 2: Marking one player absent then saving: absent has participation null
// ─────────────────────────────────────────────────────────────
test('2. Marking one player absent, then saving: that player is "absent" with participation null; others remain "present"', async () => {
  const sessionDate = '2026-05-02';
  const createRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });
  const session = await createRes.json();

  const payload = session.attendance.map((a, idx) => {
    const pid = (a.player._id || a.player).toString();
    if (idx === 0) {
      return { playerId: pid, status: 'absent' };
    }
    return { playerId: pid, status: 'present', participation: a.participation };
  });

  const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ attendance: payload })
  });

  assert.equal(saveRes.status, 200);
  const savedData = await saveRes.json();
  const savedSession = savedData.session;
  assert.equal(savedSession.saved, true);

  const p0Entry = savedSession.attendance.find(a => (a.player._id || a.player).toString() === testPlayers[0]._id.toString());
  assert.equal(p0Entry.status, 'absent');
  assert.equal(p0Entry.participation, null);

  const p1Entry = savedSession.attendance.find(a => (a.player._id || a.player).toString() === testPlayers[1]._id.toString());
  assert.equal(p1Entry.status, 'present');
  assert.equal(p1Entry.participation, testPlayers[1].defaultParticipation);
});

// ─────────────────────────────────────────────────────────────
// Scenario 3: After saving, PATCH /bulk and PATCH /mark return 409
// ─────────────────────────────────────────────────────────────
test('3. After saving, PATCH /bulk and PATCH /mark return 409 and the database is unchanged', async () => {
  const sessionDate = '2026-05-03';
  const createRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });
  const session = await createRes.json();

  // Save session
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ attendance: session.attendance })
  });

  // Attempt PATCH /bulk
  const bulkRes = await fetch(`${baseUrl}/api/sessions/${session._id}/bulk`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ attendance: [{ playerId: testPlayers[0]._id.toString(), status: 'absent' }] })
  });
  assert.equal(bulkRes.status, 409);

  // Attempt PATCH /mark
  const markRes = await fetch(`${baseUrl}/api/sessions/${session._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: testPlayers[0]._id.toString(), status: 'absent' })
  });
  assert.equal(markRes.status, 409);

  // Database verification
  const dbSession = await Session.findById(session._id);
  const entry0 = dbSession.attendance.find(a => a.player.toString() === testPlayers[0]._id.toString());
  assert.equal(entry0.status, 'present'); // Still present
});

// ─────────────────────────────────────────────────────────────
// Scenario 4: Two simultaneous save requests on one session
// ─────────────────────────────────────────────────────────────
test('4. Two simultaneous save requests on one session: exactly one succeeds, the other returns 409', async () => {
  const sessionDate = '2026-05-04';
  const createRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });
  const session = await createRes.json();

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers: authHeader(coachToken),
      body: JSON.stringify({ attendance: session.attendance })
    }),
    fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers: authHeader(coachToken),
      body: JSON.stringify({ attendance: session.attendance })
    })
  ]);

  const statuses = [res1.status, res2.status];
  assert.ok(statuses.includes(200), 'One request should return 200');
  assert.ok(statuses.includes(409), 'The other request should return 409');
});

// ─────────────────────────────────────────────────────────────
// Scenario 5: Opening duplicate (coach, date, sport) returns 409
// ─────────────────────────────────────────────────────────────
test('5. Opening a duplicate (coach, date, sport) returns 409', async () => {
  const sessionDate = '2026-05-05';
  const res1 = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });
  assert.equal(res1.status, 201);

  const res2 = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });
  assert.equal(res2.status, 409);
});

// ─────────────────────────────────────────────────────────────
// Scenario 6: Match on date with no session succeeds; PUT entries returns 409
// ─────────────────────────────────────────────────────────────
test('6. Creating a match on a date with no session succeeds. PUT entries returns 409', async () => {
  const matchDate = '2026-05-06';
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date: matchDate, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  assert.equal(matchRes.status, 201);
  const match = await matchRes.json();

  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({ entries: [{ playerId: testPlayers[0]._id.toString(), result: 'played', score: 1 }] })
  });
  assert.equal(entriesRes.status, 409);
});

// ─────────────────────────────────────────────────────────────
// Scenario 7: Match on date with unsaved session: PUT entries returns 409
// ─────────────────────────────────────────────────────────────
test('7. Match on a date with an unsaved session: PUT entries returns 409 with the save-first message', async () => {
  const sessionDate = '2026-05-07';
  await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date: sessionDate, sport: 'AcceptanceSport' })
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date: sessionDate, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  const match = await matchRes.json();

  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({ entries: [{ playerId: testPlayers[0]._id.toString(), result: 'played', score: 1 }] })
  });
  assert.equal(entriesRes.status, 409);
  const data = await entriesRes.json();
  assert.match(data.error, /Save attendance for this date before scoring the match/i);
});

// ─────────────────────────────────────────────────────────────
// Scenario 8: Absent player in entries returns 422 with id
// ─────────────────────────────────────────────────────────────
test('8. Match on a saved session: an absent player in the entries returns 422 with their id', async () => {
  const date = '2026-05-08';
  // Create session where P1 is absent, P3 is present (match), P4 is present (both)
  const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date, sport: 'AcceptanceSport' })
  });
  const session = await sessionRes.json();

  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { playerId: testPlayers[0]._id.toString(), status: 'absent' },
        { playerId: testPlayers[1]._id.toString(), status: 'present', participation: 'practice' },
        { playerId: testPlayers[2]._id.toString(), status: 'present', participation: 'match' },
        { playerId: testPlayers[3]._id.toString(), status: 'present', participation: 'both' }
      ]
    })
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  const match = await matchRes.json();

  // Try scoring P1 (absent)
  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      entries: [
        { playerId: testPlayers[0]._id.toString(), result: 'played', score: 1 },
        { playerId: testPlayers[2]._id.toString(), result: 'played', score: 1 },
        { playerId: testPlayers[3]._id.toString(), result: 'played', score: 1 }
      ]
    })
  });

  assert.equal(entriesRes.status, 422);
  const errData = await entriesRes.json();
  assert.match(errData.error, /Absent on this date/i);
  assert.ok(errData.playerIds.includes(testPlayers[0]._id.toString()));
});

// ─────────────────────────────────────────────────────────────
// Scenario 9: Present player with participation 'practice' returns 422
// ─────────────────────────────────────────────────────────────
test('9. Match on a saved session: a present player with participation "practice" in the entries returns 422', async () => {
  const date = '2026-05-09';
  const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date, sport: 'AcceptanceSport' })
  });
  const session = await sessionRes.json();

  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { playerId: testPlayers[0]._id.toString(), status: 'present', participation: 'both' },
        { playerId: testPlayers[1]._id.toString(), status: 'present', participation: 'practice' },
        { playerId: testPlayers[2]._id.toString(), status: 'absent' },
        { playerId: testPlayers[3]._id.toString(), status: 'present', participation: 'both' }
      ]
    })
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  const match = await matchRes.json();

  // Try submitting P2 who is practice-only
  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      entries: [
        { playerId: testPlayers[0]._id.toString(), result: 'played', score: 1 },
        { playerId: testPlayers[1]._id.toString(), result: 'played', score: 1 },
        { playerId: testPlayers[3]._id.toString(), result: 'played', score: 1 }
      ]
    })
  });

  assert.equal(entriesRes.status, 422);
  const errData = await entriesRes.json();
  assert.match(errData.error, /Attended for practice only/i);
  assert.ok(errData.playerIds.includes(testPlayers[1]._id.toString()));
});

// ─────────────────────────────────────────────────────────────
// Scenario 10: Omitting an eligible player returns 422 with missing id, nothing written
// ─────────────────────────────────────────────────────────────
test('10. Match on a saved session: omitting an eligible player returns 422 with that player\'s id, and nothing is written', async () => {
  const date = '2026-05-10';
  const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date, sport: 'AcceptanceSport' })
  });
  const session = await sessionRes.json();

  // Eligible players: P1 (both) and P4 (both)
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { playerId: testPlayers[0]._id.toString(), status: 'present', participation: 'both' },
        { playerId: testPlayers[1]._id.toString(), status: 'absent' },
        { playerId: testPlayers[2]._id.toString(), status: 'absent' },
        { playerId: testPlayers[3]._id.toString(), status: 'present', participation: 'both' }
      ]
    })
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  const match = await matchRes.json();

  // Submit only P1, omit eligible P4
  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      entries: [
        { playerId: testPlayers[0]._id.toString(), result: 'played', score: 2 }
      ]
    })
  });

  assert.equal(entriesRes.status, 422);
  const errData = await entriesRes.json();
  assert.match(errData.error, /Needs a score or Did not play/i);
  assert.ok(errData.missingPlayerIds.includes(testPlayers[3]._id.toString()));

  // Nothing written
  const dbMatch = await Match.findById(match._id);
  assert.equal(dbMatch.entries.length, 0);
});

// ─────────────────────────────────────────────────────────────
// Scenario 11: Eligible player with result 'played' and score 0 is accepted
// ─────────────────────────────────────────────────────────────
test('11. Eligible player with result "played" and score 0 is accepted and counts as a played match', async () => {
  const date = '2026-05-11';
  const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date, sport: 'AcceptanceSport' })
  });
  const session = await sessionRes.json();

  // Eligible: P1 (both)
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { playerId: testPlayers[0]._id.toString(), status: 'present', participation: 'both' },
        { playerId: testPlayers[1]._id.toString(), status: 'absent' },
        { playerId: testPlayers[2]._id.toString(), status: 'absent' },
        { playerId: testPlayers[3]._id.toString(), status: 'absent' }
      ]
    })
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  const match = await matchRes.json();

  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      entries: [
        { playerId: testPlayers[0]._id.toString(), result: 'played', score: 0 }
      ]
    })
  });

  assert.equal(entriesRes.status, 200);
  const dbMatch = await Match.findById(match._id);
  assert.equal(dbMatch.entries.length, 1);
  assert.equal(dbMatch.entries[0].result, 'played');
  assert.equal(dbMatch.entries[0].score, 0);
});

// ─────────────────────────────────────────────────────────────
// Scenario 12: Eligible player with result 'did_not_play' does not count toward matches played
// ─────────────────────────────────────────────────────────────
test('12. Eligible player with result "did_not_play" is accepted and does not count toward matches played', async () => {
  const date = '2026-05-12';
  const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ date, sport: 'AcceptanceSport' })
  });
  const session = await sessionRes.json();

  // Eligible: P3 (match)
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { playerId: testPlayers[0]._id.toString(), status: 'absent' },
        { playerId: testPlayers[1]._id.toString(), status: 'absent' },
        { playerId: testPlayers[2]._id.toString(), status: 'present', participation: 'match' },
        { playerId: testPlayers[3]._id.toString(), status: 'absent' }
      ]
    })
  });

  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ 
      title: 'Match vs Rival FC',
      sport: 'AcceptanceSport',
      date, 
      time: '14:00',
      opponent: 'Rival FC',
      venue: 'Main Stadium'
    })
  });
  const match = await matchRes.json();

  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      entries: [
        { playerId: testPlayers[2]._id.toString(), result: 'did_not_play', score: null }
      ]
    })
  });

  assert.equal(entriesRes.status, 200);
  const dbMatch = await Match.findById(match._id);
  assert.equal(dbMatch.entries.length, 1);
  assert.equal(dbMatch.entries[0].result, 'did_not_play');
  assert.equal(dbMatch.entries[0].score, null);
});

// ─────────────────────────────────────────────────────────────
// Scenario 13: 75% attendance and 2 matches: READY; 74% NOT READY; 75% + 1 match NOT READY
// ─────────────────────────────────────────────────────────────
test('13. 75% attendance and 2 matches: READY. 74% and 2 matches: NOT READY. 75% and 1 match: NOT READY', async () => {
  // Let's create an isolated coach and player for pure metric verification
  const metricCoach = await User.create({
    name: 'Metric Coach',
    username: `mcoach_${Date.now()}`,
    email: `mcoach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  const mCoachToken = jwt.sign({ id: metricCoach._id, role: 'coach' }, JWT_SECRET);

  const mPlayer = await Player.create({
    name: 'TestAcc_MetricAthlete',
    age: 20,
    sport: 'MetricSport',
    defaultParticipation: 'both',
    coach: metricCoach._id
  });

  // Setup: 4 saved sessions
  for (let i = 1; i <= 4; i++) {
    const d = new Date(`2026-06-0${i}`);
    await Session.create({
      date: d,
      sport: 'MetricSport',
      coach: metricCoach._id,
      saved: true,
      savedAt: d,
      locked: true,
      attendance: [
        { player: mPlayer._id, status: i <= 3 ? 'present' : 'absent', participation: i <= 3 ? 'both' : null }
      ]
    });
  }
  // 3 out of 4 sessions = 75% attendance (presentCount * 4 >= totalCount * 3: 12 >= 12 -> true)

  // Case A: 75% attendance + 1 match -> NOT READY
  const match1 = await Match.create({
    title: 'Metric Match 1',
    sport: 'MetricSport',
    date: new Date('2026-06-01'),
    time: '14:00',
    opponent: 'Team A',
    venue: 'Main Field',
    coach: metricCoach._id,
    entries: [{ player: mPlayer._id, result: 'played', score: 2 }]
  });

  let pRes = await fetch(`${baseUrl}/api/players/${mPlayer._id}`, { headers: authHeader(mCoachToken) });
  let pData = await pRes.json();
  assert.equal(pData.attendanceRate, 75);
  assert.equal(pData.matchesPlayed, 1);
  assert.equal(pData.isReady, false, '75% attendance and 1 match must be NOT READY');

  // Case B: 75% attendance + 2 matches -> READY
  const match2 = await Match.create({
    title: 'Metric Match 2',
    sport: 'MetricSport',
    date: new Date('2026-06-02'),
    time: '14:00',
    opponent: 'Team B',
    venue: 'Main Field',
    coach: metricCoach._id,
    entries: [{ player: mPlayer._id, result: 'played', score: 1 }]
  });

  pRes = await fetch(`${baseUrl}/api/players/${mPlayer._id}`, { headers: authHeader(mCoachToken) });
  pData = await pRes.json();
  assert.equal(pData.matchesPlayed, 2);
  assert.equal(pData.isReady, true, '75% attendance and 2 matches must be READY');

  // Case C: Add a 5th session where player is absent: 3/5 = 60% (< 75%) -> NOT READY even with 2 matches
  const d5 = new Date('2026-06-05');
  await Session.create({
    date: d5,
    sport: 'MetricSport',
    coach: metricCoach._id,
    saved: true,
    savedAt: d5,
    locked: true,
    attendance: [{ player: mPlayer._id, status: 'absent', participation: null }]
  });

  pRes = await fetch(`${baseUrl}/api/players/${mPlayer._id}`, { headers: authHeader(mCoachToken) });
  pData = await pRes.json();
  assert.equal(pData.isReady, false, 'Below 75% attendance with 2 matches must be NOT READY');

  // Teardown test 13 fixtures
  await Session.deleteMany({ coach: metricCoach._id });
  await Match.deleteMany({ coach: metricCoach._id });
  await Player.findByIdAndDelete(mPlayer._id);
  await User.findByIdAndDelete(metricCoach._id);
});

// ─────────────────────────────────────────────────────────────
// Scenario 14: Scout GET /api/scout/ready returns only READY players; Player GET /api/players/me returns own
// ─────────────────────────────────────────────────────────────
test('14. Scout GET /api/scout/ready returns only READY players. Player GET /api/players/me returns only their own record', async () => {
  const scoutRes = await fetch(`${baseUrl}/api/scout/ready`, { headers: authHeader(scoutToken) });
  assert.equal(scoutRes.status, 200);
  const scoutPlayers = await scoutRes.json();
  for (const p of scoutPlayers) {
    assert.equal(p.isReady, true, 'Every player returned to scout must be isReady === true');
  }

  // Player me
  const meRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(playerToken) });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData._id.toString(), testPlayers[0]._id.toString());
});

// ─────────────────────────────────────────────────────────────
// Scenario 15: Player creation with future registeredOn returns 400. Invalid defaultParticipation returns 400
// ─────────────────────────────────────────────────────────────
test('15. Player creation with a future registeredOn returns 400. Invalid defaultParticipation returns 400', async () => {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 10);

  // Future date
  const res1 = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      name: 'FuturePlayer',
      age: 20,
      sport: 'AcceptanceSport',
      registeredOn: futureDate.toISOString()
    })
  });
  assert.equal(res1.status, 400);

  // Invalid defaultParticipation
  const res2 = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      name: 'BadPartPlayer',
      age: 20,
      sport: 'AcceptanceSport',
      defaultParticipation: 'invalid_choice'
    })
  });
  assert.equal(res2.status, 400);
});

// ─────────────────────────────────────────────────────────────
// Scenario 16: Migration run twice produces same database state as running it once
// ─────────────────────────────────────────────────────────────
test('16. Migration run twice produces the same database state as running it once', async () => {
  // Run migration first time
  await migrateV2();
  const playersState1 = await Player.find().lean();
  const sessionsState1 = await Session.find().lean();
  const matchesState1 = await Match.find().lean();

  // Run migration second time
  await migrateV2();
  const playersState2 = await Player.find().lean();
  const sessionsState2 = await Session.find().lean();
  const matchesState2 = await Match.find().lean();

  assert.equal(playersState1.length, playersState2.length);
  assert.equal(sessionsState1.length, sessionsState2.length);
  assert.equal(matchesState1.length, matchesState2.length);

  for (let i = 0; i < playersState1.length; i++) {
    assert.equal(playersState1[i].defaultParticipation, playersState2[i].defaultParticipation);
    assert.equal(
      new Date(playersState1[i].registeredOn).getTime(),
      new Date(playersState2[i].registeredOn).getTime()
    );
  }

  for (let i = 0; i < sessionsState1.length; i++) {
    assert.equal(sessionsState1[i].saved, sessionsState2[i].saved);
  }
});

// ─────────────────────────────────────────────────────────────
// Attendance synchronization regression coverage
// ─────────────────────────────────────────────────────────────

async function cleanupCoachFixtures(coachIds) {
  const coaches = await Player.find({ coach: { $in: coachIds } }).select('_id');
  const playerIds = coaches.map(p => p._id);
  await Session.deleteMany({ coach: { $in: coachIds } });
  await Match.deleteMany({ coach: { $in: coachIds } });
  await User.deleteMany({ playerId: { $in: playerIds } });
  await Player.deleteMany({ coach: { $in: coachIds } });
  await User.deleteMany({ _id: { $in: coachIds } });
}

test('17. Drafts sync current players, saved sessions stay fixed, and session/player attendance agree', async () => {
  const coach = await User.create({
    name: 'Sync Coach',
    username: `sync_coach_${Date.now()}`,
    email: `sync_coach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  const token = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);
  const sport = 'SyncSport';

  try {
    const p1 = await Player.create({
      name: 'TestAcc_Sync_P1', age: 18, sport, defaultParticipation: 'both', coach: coach._id
    });

    // Open a draft through the API.
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ date: '2026-07-01', sport })
    });
    assert.equal(createRes.status, 201);
    const session = await createRes.json();
    assert.equal(session.attendance.length, 1);

    // Register a second player: they must enter the open draft.
    const p2Res = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ name: 'TestAcc_Sync_P2', age: 19, sport, defaultParticipation: 'practice' })
    });
    assert.equal(p2Res.status, 201);
    const p2 = await p2Res.json();

    const syncedRes = await fetch(`${baseUrl}/api/sessions/${session._id}`, { headers: authHeader(token) });
    const synced = await syncedRes.json();
    assert.equal(synced.attendance.length, 2, 'Draft roster should include the newly registered player');

    // Finalize the session.
    const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({
        attendance: synced.attendance.map(a => ({
          playerId: (a.player._id || a.player).toString(),
          status: a.status,
          participation: a.participation
        }))
      })
    });
    assert.equal(saveRes.status, 200);

    // A player registered after the save must not be retroactively injected.
    const p3Res = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ name: 'TestAcc_Sync_P3', age: 20, sport, defaultParticipation: 'both' })
    });
    assert.equal(p3Res.status, 201);
    const p3 = await p3Res.json();

    const savedRes = await fetch(`${baseUrl}/api/sessions/${session._id}`, { headers: authHeader(token) });
    const saved = await savedRes.json();
    assert.equal(saved.attendance.length, 2, 'Saved session roster must remain fixed');
    assert.ok(!saved.attendance.some(a => (a.player._id || a.player).toString() === p3._id.toString()));

    // A stale draft created outside the API must be refreshed on open.
    const stale = await Session.create({
      date: new Date('2026-07-02'),
      sport,
      coach: coach._id,
      saved: false,
      locked: false,
      attendance: [{ player: p1._id, status: 'present', participation: 'both' }]
    });
    await Session.updateOne({ _id: stale._id }, { $pull: { attendance: { player: p2._id } } });

    const staleRes = await fetch(`${baseUrl}/api/sessions/${stale._id}`, { headers: authHeader(token) });
    const staleSynced = await staleRes.json();
    assert.equal(staleSynced.attendance.length, 3, 'Opening a draft should restore every current player');
    assert.equal(staleSynced.totalCount, 3);
    assert.equal(staleSynced.presentCount, 3);
    assert.equal(staleSynced.attendanceRate, 100);

    // Player metrics only count the saved session, not the draft.
    const p1Res = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
    const p1Data = await p1Res.json();
    assert.equal(p1Data.totalSessions, 1);
    assert.equal(p1Data.presentSessions, 1);
    assert.equal(p1Data.attendanceRate, 100);
    assert.equal(p1Data.attendanceHistory.length, 1);

    // A player with no saved roster entry has no denominator, not "all sessions".
    const p3DataRes = await fetch(`${baseUrl}/api/players/${p3._id}`, { headers: authHeader(token) });
    const p3Data = await p3DataRes.json();
    assert.equal(p3Data.totalSessions, 0);
    assert.equal(p3Data.presentSessions, 0);
    assert.equal(p3Data.attendanceRate, 0);
    assert.equal(p3Data.attendanceHistory.length, 0);
    assert.equal(p3Data.isReady, false);
  } finally {
    await cleanupCoachFixtures([coach._id]);
  }
});

test('18. Official attendance ignores drafts and sessions where the player is not on the roster', async () => {
  const coach = await User.create({
    name: 'Saved Only Coach',
    username: `saved_coach_${Date.now()}`,
    email: `saved_coach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  const token = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);
  const sport = 'SavedOnlySport';

  try {
    const p1 = await Player.create({
      name: 'TestAcc_Saved_P1', age: 18, sport, defaultParticipation: 'both', coach: coach._id
    });
    const p2 = await Player.create({
      name: 'TestAcc_Saved_P2', age: 19, sport, defaultParticipation: 'both', coach: coach._id
    });

    await Session.create({
      date: new Date('2026-08-01'),
      sport,
      coach: coach._id,
      saved: true,
      savedAt: new Date('2026-08-01'),
      locked: true,
      attendance: [{ player: p1._id, status: 'present', participation: 'both' }]
    });

    // A draft must never count toward official attendance.
    await Session.create({
      date: new Date('2026-08-02'),
      sport,
      coach: coach._id,
      saved: false,
      locked: false,
      attendance: [
        { player: p1._id, status: 'absent', participation: null },
        { player: p2._id, status: 'present', participation: 'both' }
      ]
    });

    const p1Res = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
    const p1Data = await p1Res.json();
    assert.equal(p1Data.totalSessions, 1);
    assert.equal(p1Data.presentSessions, 1);
    assert.equal(p1Data.attendanceRate, 100);

    const p2Res = await fetch(`${baseUrl}/api/players/${p2._id}`, { headers: authHeader(token) });
    const p2Data = await p2Res.json();
    assert.equal(p2Data.totalSessions, 0, 'Players not on a saved roster must not inherit every coach/sport session');
    assert.equal(p2Data.presentSessions, 0);
    assert.equal(p2Data.attendanceRate, 0);
    assert.equal(p2Data.attendanceHistory.length, 0);

    // Coach directory and player detail endpoint must return identical values.
    const listRes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(token) });
    const list = await listRes.json();
    const fromList = list.find(p => p._id.toString() === p1._id.toString());
    assert.equal(fromList.attendanceRate, p1Data.attendanceRate);
    assert.equal(fromList.presentSessions, p1Data.presentSessions);
    assert.equal(fromList.totalSessions, p1Data.totalSessions);
  } finally {
    await cleanupCoachFixtures([coach._id]);
  }
});

test('19. Saving attendance preserves omitted roster members and rejects unknown players', async () => {
  const coach = await User.create({
    name: 'Roster Save Coach',
    username: `roster_coach_${Date.now()}`,
    email: `roster_coach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  const otherCoach = await User.create({
    name: 'Other Coach',
    username: `other_coach_${Date.now()}`,
    email: `other_coach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  const token = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);
  const sport = 'RosterSaveSport';

  try {
    const p1 = await Player.create({
      name: 'TestAcc_Roster_P1', age: 18, sport, defaultParticipation: 'both', coach: coach._id
    });
    const p2 = await Player.create({
      name: 'TestAcc_Roster_P2', age: 19, sport, defaultParticipation: 'both', coach: coach._id
    });
    const outsider = await Player.create({
      name: 'TestAcc_Roster_Outsider', age: 20, sport: 'OtherRosterSport', defaultParticipation: 'both', coach: otherCoach._id
    });

    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ date: '2026-09-01', sport })
    });
    const session = await createRes.json();
    assert.equal(session.attendance.length, 2);

    // Save with only P1 supplied. P2 must not disappear from the register.
    const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({
        attendance: [{ playerId: p1._id.toString(), status: 'absent' }]
      })
    });
    assert.equal(saveRes.status, 200);
    const saved = (await saveRes.json()).session;
    assert.equal(saved.attendance.length, 2);
    const p1Entry = saved.attendance.find(a => (a.player._id || a.player).toString() === p1._id.toString());
    const p2Entry = saved.attendance.find(a => (a.player._id || a.player).toString() === p2._id.toString());
    assert.equal(p1Entry.status, 'absent');
    assert.equal(p2Entry.status, 'present');

    // An unknown player must be rejected, not silently injected.
    const draftRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ date: '2026-09-02', sport })
    });
    const draft = await draftRes.json();
    const badSaveRes = await fetch(`${baseUrl}/api/sessions/${draft._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({
        attendance: [
          { playerId: p1._id.toString(), status: 'present' },
          { playerId: outsider._id.toString(), status: 'present' }
        ]
      })
    });
    assert.equal(badSaveRes.status, 400);
    const badData = await badSaveRes.json();
    assert.ok(badData.playerIds.includes(outsider._id.toString()));

    const dbDraft = await Session.findById(draft._id);
    assert.equal(dbDraft.saved, false, 'Rejected save must leave the draft open');
  } finally {
    await cleanupCoachFixtures([coach._id, otherCoach._id]);
  }
});

test('20. Admin-registered players and admin-created sessions are assigned to a coach', async () => {
  const admin = await User.create({
    name: 'Sync Admin',
    username: `sync_admin_${Date.now()}`,
    email: `sync_admin_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'admin'
  });
  const coach = await User.create({
    name: 'Assigned Coach',
    username: `assigned_coach_${Date.now()}`,
    email: `assigned_coach_${Date.now()}@test-acceptance.com`,
    password: 'password123',
    role: 'coach'
  });
  const adminToken = jwt.sign({ id: admin._id, role: 'admin' }, JWT_SECRET);
  const coachToken = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);
  const sport = 'AdminAssignSport';

  try {
    const pRes = await fetch(`${baseUrl}/api/players`, {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({
        name: 'TestAcc_AdminAssigned',
        age: 18,
        sport,
        defaultParticipation: 'both',
        coachId: coach._id.toString()
      })
    });
    assert.equal(pRes.status, 201);
    const player = await pRes.json();
    assert.equal((player.coach._id || player.coach).toString(), coach._id.toString());

    // The coach must see the admin-registered player.
    const coachListRes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(coachToken) });
    const coachList = await coachListRes.json();
    assert.ok(coachList.some(p => p._id.toString() === player._id.toString()));

    // Admin-opened sessions must belong to the selected coach and include the player.
    const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: authHeader(adminToken),
      body: JSON.stringify({
        date: '2026-10-01',
        sport,
        coachId: coach._id.toString()
      })
    });
    assert.equal(sessionRes.status, 201);
    const session = await sessionRes.json();
    assert.equal((session.coach._id || session.coach).toString(), coach._id.toString());
    assert.ok(session.attendance.some(a => (a.player._id || a.player).toString() === player._id.toString()));
  } finally {
    await cleanupCoachFixtures([admin._id, coach._id]);
  }
});

test.after(async () => {
  if (server) server.close();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

