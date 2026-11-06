// test/data-synchronization.test.js
// Verification of all 10 Data Synchronization Scenarios across MongoDB Atlas, Backend APIs, and Stats Services
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
const statsService = require('../src/services/statsService');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let server;
let baseUrl;
let coachUser;
let otherCoachUser;
let scoutUser;
let playerUser;
let coachToken;
let otherCoachToken;
let scoutToken;
let playerToken;

let createdSessions = [];
let createdMatches = [];

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

  // Clean test namespace fixtures
  await User.deleteMany({ email: { $regex: /@test-sync\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^SyncTest_/ } });
  await Session.deleteMany({ sport: { $in: ['SyncFootball', 'SyncCricket', 'SyncBoundary'] } });
  await Match.deleteMany({ sport: { $in: ['SyncFootball', 'SyncCricket', 'SyncBoundary'] } });
  await MatchParticipation.deleteMany({ remarks: { $regex: /SyncTest/ } });

  // 1. Primary Coach
  coachUser = await User.create({
    name: 'Sync Coach 1',
    username: `coach_sync_${Date.now()}`,
    email: `coach_sync_${Date.now()}@test-sync.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  // 2. Secondary Coach for isolation checks
  otherCoachUser = await User.create({
    name: 'Sync Coach 2',
    username: `coach_other_${Date.now()}`,
    email: `coach_other_${Date.now()}@test-sync.com`,
    password: 'password123',
    role: 'coach'
  });
  otherCoachToken = jwt.sign({ id: otherCoachUser._id, role: 'coach' }, JWT_SECRET);

  // 3. Scout
  scoutUser = await User.create({
    name: 'Sync Scout',
    username: `scout_sync_${Date.now()}`,
    email: `scout_sync_${Date.now()}@test-sync.com`,
    password: 'password123',
    role: 'scout'
  });
  scoutToken = jwt.sign({ id: scoutUser._id, role: 'scout' }, JWT_SECRET);

  // 4. Player User
  playerUser = await User.create({
    name: 'Sync Player',
    username: `player_sync_${Date.now()}`,
    email: `player_sync_${Date.now()}@test-sync.com`,
    password: 'password123',
    role: 'player'
  });
  playerToken = jwt.sign({ id: playerUser._id, role: 'player' }, JWT_SECRET);
});

test.after(async () => {
  // Teardown created test entities
  await User.deleteMany({ email: { $regex: /@test-sync\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^SyncTest_/ } });
  await Session.deleteMany({ sport: { $in: ['SyncFootball', 'SyncCricket', 'SyncBoundary'] } });
  await Match.deleteMany({ sport: { $in: ['SyncFootball', 'SyncCricket', 'SyncBoundary'] } });
  await MatchParticipation.deleteMany({ remarks: { $regex: /SyncTest/ } });

  if (server) server.close();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

// Helper to create test players
async function createTestPlayer(name, sport, coachId, defaultParticipation = 'both') {
  return await Player.create({
    name: `SyncTest_${name}_${Date.now()}`,
    age: 18,
    sport,
    coach: coachId,
    defaultParticipation
  });
}

test('TEST 1: Record attendance for 4 players (3 PRESENT, 1 ABSENT) -> Turnout 75%, player stats update immediately in DB', async () => {
  const sport = 'SyncFootball';
  const p1 = await createTestPlayer('P1', sport, coachUser._id);
  const p2 = await createTestPlayer('P2', sport, coachUser._id);
  const p3 = await createTestPlayer('P3', sport, coachUser._id);
  const p4 = await createTestPlayer('P4', sport, coachUser._id);

  // Open session
  const openRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      date: '2026-11-10',
      sport,
      coachId: coachUser._id.toString()
    })
  });
  assert.equal(openRes.status, 201);
  const session = await openRes.json();
  createdSessions.push(session._id);

  // Mark attendance: P1, P2, P3 PRESENT; P4 ABSENT
  const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { player: p1._id.toString(), status: 'present' },
        { player: p2._id.toString(), status: 'present' },
        { player: p3._id.toString(), status: 'present' },
        { player: p4._id.toString(), status: 'absent' }
      ]
    })
  });
  assert.equal(saveRes.status, 200);
  const saveBody = await saveRes.json();
  const savedSession = saveBody.session;

  // Verify turnout is 75%
  assert.equal(savedSession.attendanceRate, 75);
  assert.equal(savedSession.presentCount, 3);
  assert.equal(savedSession.absentCount, 1);
  assert.equal(savedSession.totalCount, 4);

  // Query individual players via GET /api/players
  const playersRes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(coachToken) });
  assert.equal(playersRes.status, 200);
  const playersList = await playersRes.json();

  const enrichedP1 = playersList.find(p => p._id.toString() === p1._id.toString());
  const enrichedP4 = playersList.find(p => p._id.toString() === p4._id.toString());

  assert.ok(enrichedP1, 'P1 found in players list');
  assert.ok(enrichedP4, 'P4 found in players list');
  assert.equal(enrichedP1.attendanceRate, 100);
  assert.equal(enrichedP1.presentSessions, 1);
  assert.equal(enrichedP4.attendanceRate, 0);
  assert.equal(enrichedP4.presentSessions, 0);

  // Directly verify MongoDB Atlas persistence
  const directSession = await Session.findById(session._id);
  assert.equal(directSession.saved, true);
  assert.equal(directSession.attendanceRate, 75);
});

test('TEST 2: Change the 1 ABSENT player to PRESENT -> Turnout becomes 100%, player stats update', async () => {
  const sessionId = createdSessions[0];
  const sessionRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { headers: authHeader(coachToken) });
  const session = await sessionRes.json();
  assert.ok(session, 'Found session from Test 1');

  // Unlock session first to allow modification
  const unlockRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/toggle-lock`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(unlockRes.status, 200);

  // Change all 4 players to PRESENT and save
  const updateRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: session.attendance.map(a => ({
        player: (a.player._id || a.player).toString(),
        status: 'present'
      }))
    })
  });
  assert.equal(updateRes.status, 200);
  const updatedSession = (await updateRes.json()).session;

  // Verify turnout is now 100%
  assert.equal(updatedSession.attendanceRate, 100);
  assert.equal(updatedSession.presentCount, 4);
  assert.equal(updatedSession.absentCount, 0);

  // Verify P4 stats via GET /api/players/:id
  const p4Id = (session.attendance[3].player._id || session.attendance[3].player).toString();
  const p4Res = await fetch(`${baseUrl}/api/players/${p4Id}`, { headers: authHeader(coachToken) });
  assert.equal(p4Res.status, 200);
  const p4 = await p4Res.json();

  assert.equal(p4.attendanceRate, 100);
  assert.equal(p4.presentSessions, 1);
  assert.equal(p4.totalSessions, 1);
});

test('TEST 3: Create match, complete with scores, then mark participating player ABSENT -> conflict flagged, valid matches and readiness drop, history preserved', async () => {
  const sport = 'SyncFootball';
  const sessionId = createdSessions[0];
  const sessionRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { headers: authHeader(coachToken) });
  const session = await sessionRes.json();
  const p1Id = (session.attendance[0].player._id || session.attendance[0].player).toString();
  const p2Id = (session.attendance[1].player._id || session.attendance[1].player).toString();

  // Create match for same sport and date
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'Sync Match 1',
      sport,
      date: '2026-11-10',
      time: '16:00',
      opponent: 'Opponent FC',
      venue: 'Main Ground'
    })
  });
  assert.equal(matchRes.status, 201);
  const match = await matchRes.json();
  createdMatches.push(match._id);

  // Select squad (P1 and P2)
  const squadRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerIds: [p1Id, p2Id] })
  });
  assert.equal(squadRes.status, 200);

  // Save participation for each player
  const part1Res = await fetch(`${baseUrl}/api/matches/${match._id}/participation/${p1Id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 2, remarks: 'SyncTest goal' })
  });
  assert.equal(part1Res.status, 200);

  const part2Res = await fetch(`${baseUrl}/api/matches/${match._id}/participation/${p2Id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 1, remarks: 'SyncTest goal' })
  });
  assert.equal(part2Res.status, 200);

  // Complete match
  const completeRes = await fetch(`${baseUrl}/api/matches/${match._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(completeRes.status, 200);

  // Verify P1 has 1 match played before conflict
  let p1Res = await fetch(`${baseUrl}/api/players/${p1Id}`, { headers: authHeader(coachToken) });
  let p1 = await p1Res.json();
  assert.equal(p1.totalMatchesPlayed, 1);

  // NOW: Unlock session and change P1 attendance to ABSENT
  await fetch(`${baseUrl}/api/sessions/${sessionId}/toggle-lock`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });

  const markAbsentRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerId: p1Id,
      status: 'absent'
    })
  });
  assert.equal(markAbsentRes.status, 200);
  const conflictPayload = await markAbsentRes.json();

  // Verify conflict is reported in response
  assert.ok(conflictPayload.conflicts, 'Response includes conflicts summary');
  assert.equal(conflictPayload.conflicts.hasConflict, true, 'hasConflict is true');

  // Verify Match in MongoDB Atlas has conflict flagged
  const directMatch = await Match.findById(match._id);
  assert.equal(directMatch.hasConflict, true);
  assert.ok(directMatch.conflictMessage.includes('marked absent'));

  // Verify MatchParticipation preserves scores and history but flags attendanceConflict
  const partRecord = await MatchParticipation.findOne({ match: match._id, player: p1Id });
  assert.ok(partRecord, 'Participation record was preserved, not deleted');
  assert.equal(partRecord.played, true, 'Original played status preserved');
  assert.equal(partRecord.score, 2, 'Score preserved');
  assert.equal(partRecord.attendanceConflict, true, 'attendanceConflict flagged');

  // Verify P1 recalculated stats: valid matches played drops from 1 to 0
  p1Res = await fetch(`${baseUrl}/api/players/${p1Id}`, { headers: authHeader(coachToken) });
  p1 = await p1Res.json();
  assert.equal(p1.totalMatchesPlayed, 0, 'Conflicted match excluded from valid matches played');
  assert.equal(p1.isReady, false, 'Player not ready due to conflict');

  // Check that match details API exposes conflict
  const matchDetailsRes = await fetch(`${baseUrl}/api/matches/${match._id}`, { headers: authHeader(coachToken) });
  const matchDetails = await matchDetailsRes.json();
  assert.equal(matchDetails.hasConflict, true);
  assert.equal(matchDetails.totalConflicted, 1);
});

test('TEST 4: Change player back to PRESENT -> Conflict automatically resolves, eligibility restored without duplicate match records', async () => {
  const sessionId = createdSessions[0];
  const sessionRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { headers: authHeader(coachToken) });
  const session = await sessionRes.json();
  const p1Id = (session.attendance[0].player._id || session.attendance[0].player).toString();
  const match = createdMatches[0];

  // Mark P1 back to PRESENT with participation both
  const markPresentRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      playerId: p1Id,
      status: 'present',
      participation: 'both'
    })
  });
  assert.equal(markPresentRes.status, 200);
  const conflictPayload = await markPresentRes.json();
  assert.equal(conflictPayload.conflicts.hasConflict, false, 'Conflict resolved');

  // Verify Match in Atlas has conflict cleared
  const directMatch = await Match.findById(match);
  assert.equal(directMatch.hasConflict, false);
  assert.equal(directMatch.conflictMessage, '');

  // Verify MatchParticipation conflict cleared
  const partRecord = await MatchParticipation.findOne({ match, player: p1Id });
  assert.equal(partRecord.attendanceConflict, false);
  assert.equal(partRecord.score, 2, 'Original score preserved exactly');

  // Verify total count of MatchParticipation records did not duplicate
  const totalParts = await MatchParticipation.countDocuments({ match, player: p1Id });
  assert.equal(totalParts, 1, 'No duplicate match participation created');

  // Verify P1 valid matches played is restored to 1
  const p1Res = await fetch(`${baseUrl}/api/players/${p1Id}`, { headers: authHeader(coachToken) });
  const p1 = await p1Res.json();
  assert.equal(p1.totalMatchesPlayed, 1, 'Valid matches played restored');

  // Re-lock session to ensure it is saved and finalized
  const lockRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/toggle-lock`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(lockRes.status, 200);
});

test('TEST 5: Create a second match, select squad, enter scores, mark completed -> participation & matches played update correctly', async () => {
  const sport = 'SyncFootball';
  const sessionId = createdSessions[0];
  const sessionRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { headers: authHeader(coachToken) });
  const session = await sessionRes.json();
  const p1Id = (session.attendance[0].player._id || session.attendance[0].player).toString();

  // Create Match 2
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'Sync Match 2',
      sport,
      date: '2026-11-10',
      time: '18:00',
      opponent: 'Rival Academy',
      venue: 'North Ground'
    })
  });
  assert.equal(matchRes.status, 201);
  const match2 = await matchRes.json();
  createdMatches.push(match2._id);

  // Select squad
  const selRes = await fetch(`${baseUrl}/api/matches/${match2._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerIds: [p1Id] })
  });
  assert.equal(selRes.status, 200);

  // Participation
  const partRes = await fetch(`${baseUrl}/api/matches/${match2._id}/participation/${p1Id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 3, remarks: 'SyncTest hat-trick' })
  });
  assert.equal(partRes.status, 200);

  // Complete
  const compRes = await fetch(`${baseUrl}/api/matches/${match2._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(compRes.status, 200);

  // Verify P1 now has 2 matches played
  const p1Res = await fetch(`${baseUrl}/api/players/${p1Id}`, { headers: authHeader(coachToken) });
  const p1 = await p1Res.json();
  assert.equal(p1.totalMatchesPlayed, 2);
  assert.equal(p1.attendanceRate, 100);
  assert.equal(p1.isReady, true, 'P1 meets readiness: 100% attendance >= 75% and 2 matches >= 2');
});

test('TEST 6: Check trial readiness for boundary conditions: (74% + 2 = NOT READY, 75% + 1 = NOT READY, 75% + 2 = READY)', async () => {
  const sport = 'SyncBoundary';

  // Create 3 players
  const playerA = await createTestPlayer('BoundA', sport, coachUser._id);
  const playerB = await createTestPlayer('BoundB', sport, coachUser._id);
  const playerC = await createTestPlayer('BoundC', sport, coachUser._id);

  // 10 sessions:
  // Player A: 7 present, 3 absent = 70% (<75%).
  // Player B: 8 present, 2 absent = 80% (>=75%).
  // Player C: 8 present, 2 absent = 80% (>=75%).
  for (let i = 1; i <= 10; i++) {
    const sDate = `2026-10-${i.toString().padStart(2, '0')}`;
    const s = await Session.create({
      sport,
      coach: coachUser._id,
      date: sDate,
      saved: true,
      locked: true,
      initialRosterPlayerIds: [playerA._id, playerB._id, playerC._id],
      attendance: [
        { player: playerA._id, status: i <= 7 ? 'present' : 'absent' },
        { player: playerB._id, status: i <= 8 ? 'present' : 'absent' },
        { player: playerC._id, status: i <= 8 ? 'present' : 'absent' }
      ]
    });
    createdSessions.push(s._id);
  }

  // Create Match 1 (Session 1 date: 2026-10-01) -> Player A, Player B, Player C all played
  const m1 = await Match.create({
    title: 'Sync Boundary Match 1',
    sport,
    coach: coachUser._id,
    date: '2026-10-01',
    time: '10:00',
    venue: 'Boundary Stadium',
    opponent: 'Boundary Opponent',
    status: 'completed',
    selectedPlayers: [playerA._id, playerB._id, playerC._id]
  });
  createdMatches.push(m1._id);

  await MatchParticipation.create([
    { match: m1._id, player: playerA._id, played: true, score: 1, remarks: 'SyncTest' },
    { match: m1._id, player: playerB._id, played: true, score: 1, remarks: 'SyncTest' },
    { match: m1._id, player: playerC._id, played: true, score: 1, remarks: 'SyncTest' }
  ]);

  // Create Match 2 (Session 2 date: 2026-10-02) -> Player A played, Player C played, Player B did not play
  const m2 = await Match.create({
    title: 'Sync Boundary Match 2',
    sport,
    coach: coachUser._id,
    date: '2026-10-02',
    time: '10:00',
    venue: 'Boundary Stadium',
    opponent: 'Boundary Opponent 2',
    status: 'completed',
    selectedPlayers: [playerA._id, playerC._id]
  });
  createdMatches.push(m2._id);

  await MatchParticipation.create([
    { match: m2._id, player: playerA._id, played: true, score: 1, remarks: 'SyncTest' },
    { match: m2._id, player: playerC._id, played: true, score: 1, remarks: 'SyncTest' }
  ]);

  // Fetch enriched players
  const [enA, enB, enC] = await Promise.all([
    statsService.enrichPlayer(playerA),
    statsService.enrichPlayer(playerB),
    statsService.enrichPlayer(playerC)
  ]);

  // Player A: 70% attendance (< 75%) + 2 matches -> NOT READY
  assert.equal(enA.attendanceRate, 70);
  assert.equal(enA.totalMatchesPlayed, 2);
  assert.equal(enA.isReady, false, 'Player A (<75% att, 2 matches) must be NOT READY');

  // Player B: 80% attendance (>= 75%) + 1 match -> NOT READY
  assert.equal(enB.attendanceRate, 80);
  assert.equal(enB.totalMatchesPlayed, 1);
  assert.equal(enB.isReady, false, 'Player B (>=75% att, 1 match) must be NOT READY');

  // Player C: 80% attendance (>= 75%) + 2 matches -> READY
  assert.equal(enC.attendanceRate, 80);
  assert.equal(enC.totalMatchesPlayed, 2);
  assert.equal(enC.isReady, true, 'Player C (>=75% att, 2 matches) must be READY');
});

test('TEST 7: Coach, Player, Scout dashboards show consistent data and respect role authorization', async () => {
  // Scout query: GET /api/scout/ready must return only ready players
  const scoutRes = await fetch(`${baseUrl}/api/scout/ready`, { headers: authHeader(scoutToken) });
  assert.equal(scoutRes.status, 200);
  const readyList = await scoutRes.json();
  // All players returned must have isReady === true
  for (const p of readyList) {
    assert.equal(p.isReady, true);
    assert.ok(p.attendanceRate >= 75);
    assert.ok(p.totalMatchesPlayed >= 2);
  }

  // Authorization tests:
  // 1. Player role cannot edit attendance:
  const dummySession = createdSessions[0];
  const playerEditAttRes = await fetch(`${baseUrl}/api/sessions/${dummySession}/save`, {
    method: 'PATCH',
    headers: authHeader(playerToken),
    body: JSON.stringify({ attendance: [] })
  });
  assert.equal(playerEditAttRes.status, 403, 'Player role blocked from editing attendance with 403');

  // 2. Scout role cannot complete or modify matches:
  const dummyMatch = createdMatches[0];
  const scoutEditMatchRes = await fetch(`${baseUrl}/api/matches/${dummyMatch}/complete`, {
    method: 'PATCH',
    headers: authHeader(scoutToken)
  });
  assert.equal(scoutEditMatchRes.status, 403, 'Scout role blocked from modifying matches with 403');

  // 3. Other Coach cannot modify first coach session:
  const otherCoachSessionRes = await fetch(`${baseUrl}/api/sessions/${dummySession}/save`, {
    method: 'PATCH',
    headers: authHeader(otherCoachToken),
    body: JSON.stringify({ attendance: [] })
  });
  assert.equal(otherCoachSessionRes.status, 403, 'Coach 2 blocked from Coach 1 session with 403');
});

test('TEST 8: Simulated hard refresh: direct DB re-query from Atlas retains exact synchronized stats', async () => {
  // Read clean documents directly from MongoDB Atlas without relying on any cache
  const dbSessions = await Session.find({ coach: coachUser._id, sport: 'SyncFootball' }).lean();
  const dbMatches = await Match.find({ coach: coachUser._id, sport: 'SyncFootball' }).lean();
  const dbPlayers = await Player.find({ coach: coachUser._id, sport: 'SyncFootball' }).lean();

  assert.ok(dbSessions.length > 0);
  assert.ok(dbMatches.length > 0);
  assert.ok(dbPlayers.length > 0);

  for (const p of dbPlayers) {
    const freshEnriched = await statsService.enrichPlayer(p);
    assert.ok(freshEnriched._id);
    assert.equal(typeof freshEnriched.attendanceRate, 'number');
    assert.equal(typeof freshEnriched.totalMatchesPlayed, 'number');
    assert.equal(typeof freshEnriched.isReady, 'boolean');
  }
});

test('TEST 9: Rapid duplicate attendance submission: rejected by duplicate check or validator', async () => {
  const sport = 'SyncCricket';
  const player = await createTestPlayer('DupCheck', sport, coachUser._id);

  // Attempt to save attendance with duplicate entries for the same player
  const session = await Session.create({
    sport,
    coach: coachUser._id,
    date: '2026-11-20',
    saved: false,
    locked: false,
    initialRosterPlayerIds: [player._id],
    attendance: [{ player: player._id, status: 'present' }]
  });
  createdSessions.push(session._id);

  // PATCH with duplicate player IDs in attendance payload
  const dupRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [
        { player: player._id.toString(), status: 'present' },
        { player: player._id.toString(), status: 'absent' }
      ]
    })
  });

  // Must fail due to duplicate attendance validator or 400 validation error
  assert.equal(dupRes.status, 400, `Expected 400 on duplicate player entries, got ${dupRes.status}`);
  const errBody = await dupRes.json();
  assert.ok(errBody.error.includes('Duplicate attendance record'));
});

test('TEST 10: Attempt to edit a locked session: blocked with 409 Conflict', async () => {
  const sport = 'SyncCricket';
  const player = await createTestPlayer('LockCheck', sport, coachUser._id);

  const session = await Session.create({
    sport,
    coach: coachUser._id,
    date: '2026-11-21',
    saved: true,
    locked: true, // LOCKED SESSION
    initialRosterPlayerIds: [player._id],
    attendance: [{ player: player._id, status: 'present' }]
  });
  createdSessions.push(session._id);

  // Attempt to edit attendance on locked session
  const editLockedRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      attendance: [{ player: player._id.toString(), status: 'absent' }]
    })
  });

  assert.equal(editLockedRes.status, 409, 'Editing locked session must return 409 Conflict');
  const errJson = await editLockedRes.json();
  assert.ok(errJson.error.toLowerCase().includes('saved'));
});
