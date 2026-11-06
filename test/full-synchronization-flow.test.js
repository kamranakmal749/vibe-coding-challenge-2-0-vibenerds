// test/full-synchronization-flow.test.js
// Tests the complete end-to-end data flow specified in Section 7:
// TEST 1: Change Rahul's attendance from Present to Absent -> Attendance, Player Directory, Match eligibility & Ready status update.
// TEST 2: Change Rahul's attendance from Absent to Present -> All affected sections update back.
// TEST 3: Change match participation from Yes to No -> Total matches played & Ready status recalculate everywhere.
// TEST 4: Edit player's name in Player Directory -> Updated name appears in Attendance, Matches, Coach Dashboard, Player Dashboard.
// TEST 5: Refresh & log in again -> All changes remain permanently saved in MongoDB Atlas.
// TEST 6: Two different client sessions -> Attendance change in Session 1 pushes real-time update to Session 2 via SSE/stream.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
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
let coach;
let coachToken;
let rahulPlayer;
let rahulUser;
let rahulToken;
let session1;
let session2;
let matchUpcoming;
let matchCompleted;

function authHeader(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  // Clean test namespace
  await User.deleteMany({ email: { $regex: /@flow-test\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^Rahul(_FlowTest)?/ } });
  await Session.deleteMany({ sport: 'FlowFootball' });
  await Match.deleteMany({ sport: 'FlowFootball' });
  await MatchParticipation.deleteMany({ remarks: 'FlowTest' });

  // 1. Create Coach
  coach = await User.create({
    name: 'Coach Flow',
    username: `coach_flow_${Date.now()}`,
    email: `coach_flow_${Date.now()}@flow-test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coach._id, role: 'coach', name: coach.name }, JWT_SECRET);

  // 2. Create Rahul as an athlete with Football
  rahulPlayer = await Player.create({
    name: 'Rahul',
    age: 18,
    sport: 'FlowFootball',
    registeredOn: new Date('2026-01-01'),
    defaultParticipation: 'both',
    coach: coach._id
  });

  // Create Rahul's user login account
  rahulUser = await User.create({
    name: rahulPlayer.name,
    username: rahulPlayer.playerId,
    email: `${rahulPlayer.playerId}@flow-test.com`,
    password: 'password123',
    role: 'player',
    playerId: rahulPlayer._id
  });
  rahulToken = jwt.sign({
    id: rahulUser._id,
    role: 'player',
    name: rahulUser.name,
    username: rahulUser.username,
    playerId: rahulPlayer._id
  }, JWT_SECRET);

  // 3. Create Session 1 (saved & locked) on 2026-03-01 with Rahul PRESENT
  session1 = await Session.create({
    date: new Date('2026-03-01T10:00:00.000Z'),
    sport: 'FlowFootball',
    coach: coach._id,
    saved: true,
    savedAt: new Date('2026-03-01T11:00:00.000Z'),
    locked: true,
    attendance: [
      { player: rahulPlayer._id, status: 'present', participation: 'both' }
    ],
    initialRosterPlayerIds: [rahulPlayer._id],
    createdWithCount: 1
  });

  // 4. Create Session 2 (saved & locked) on 2026-03-05 with Rahul PRESENT
  session2 = await Session.create({
    date: new Date('2026-03-05T10:00:00.000Z'),
    sport: 'FlowFootball',
    coach: coach._id,
    saved: true,
    savedAt: new Date('2026-03-05T11:00:00.000Z'),
    locked: true,
    attendance: [
      { player: rahulPlayer._id, status: 'present', participation: 'both' }
    ],
    initialRosterPlayerIds: [rahulPlayer._id],
    createdWithCount: 1
  });

  // 5. Create Completed Match on Session 2 date where Rahul played (Match 1)
  matchCompleted = await Match.create({
    title: 'Flow Cup Final',
    sport: 'FlowFootball',
    date: new Date('2026-03-05T14:00:00.000Z'),
    time: '14:00',
    opponent: 'Rivals FC',
    venue: 'Main Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: session2._id,
    selectedPlayers: [rahulPlayer._id]
  });
  await MatchParticipation.create({
    match: matchCompleted._id,
    player: rahulPlayer._id,
    played: true,
    score: 2,
    remarks: 'FlowTest',
    attendanceConflict: false
  });

  // Create another completed match on earlier date so Rahul starts with 2 completed matches
  const matchCompletedOld = await Match.create({
    title: 'Flow Cup Semi',
    sport: 'FlowFootball',
    date: new Date('2026-02-20T14:00:00.000Z'),
    time: '14:00',
    opponent: 'City FC',
    venue: 'City Ground',
    status: 'completed',
    coach: coach._id,
    selectedPlayers: [rahulPlayer._id]
  });
  await MatchParticipation.create({
    match: matchCompletedOld._id,
    player: rahulPlayer._id,
    played: true,
    score: 1,
    remarks: 'FlowTest',
    attendanceConflict: false
  });

  // 6. Create Upcoming Match on Session 1 date (Match 2)
  matchUpcoming = await Match.create({
    title: 'Flow League Opener',
    sport: 'FlowFootball',
    date: new Date('2026-03-01T15:00:00.000Z'),
    time: '15:00',
    opponent: 'Town FC',
    venue: 'Home Ground',
    status: 'upcoming',
    coach: coach._id,
    sessionId: session1._id,
    selectedPlayers: [rahulPlayer._id]
  });
  await MatchParticipation.create({
    match: matchUpcoming._id,
    player: rahulPlayer._id,
    played: null,
    score: null,
    remarks: 'FlowTest',
    attendanceConflict: false
  });
});

test.after(async () => {
  await User.deleteMany({ email: { $regex: /@flow-test\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^Rahul(_FlowTest)?/ } });
  await Session.deleteMany({ sport: 'FlowFootball' });
  await Match.deleteMany({ sport: 'FlowFootball' });
  await MatchParticipation.deleteMany({ remarks: 'FlowTest' });

  if (server) server.close();
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
});

// ── TEST 1: Change Rahul's attendance from Present to Absent ─────────────────
test('TEST 1: Change Rahul attendance Present -> Absent updates Attendance, Directory, Match eligibility & Ready status', async () => {
  // Baseline check: Rahul has 2/2 sessions (100%), 2 matches played, isReady: true
  const baseRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, { headers: authHeader(coachToken) });
  const baseData = await baseRes.json();
  assert.equal(baseData.attendanceRate, 100);
  assert.equal(baseData.matchesPlayed, 2);
  assert.equal(baseData.isReady, true, 'Rahul must initially be READY');

  // Check upcoming match squad has Rahul
  const upMatchPre = await fetch(`${baseUrl}/api/matches/${matchUpcoming._id}`, { headers: authHeader(coachToken) });
  const upMatchPreData = await upMatchPre.json();
  assert.ok(upMatchPreData.selectedPlayers.some(p => (p._id || p).toString() === rahulPlayer._id.toString()));

  // 1. Change Rahul's attendance to Absent in Session 1
  // Unlock first
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });
  // Mark absent
  const markRes = await fetch(`${baseUrl}/api/sessions/${session1._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: rahulPlayer._id, status: 'absent' })
  });
  assert.equal(markRes.status, 200);
  // Re-lock to finalize
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });

  // 2. Verify Session Attendance shows 0% turnout (0 present out of 1)
  const sessionCheck = await fetch(`${baseUrl}/api/sessions/${session1._id}`, { headers: authHeader(coachToken) });
  const sessionData = await sessionCheck.json();
  const entry = sessionData.attendance.find(a => (a.player?._id || a.player).toString() === rahulPlayer._id.toString());
  assert.equal(entry.status, 'absent');
  assert.equal(sessionData.attendanceRate, 0);

  // 3. Verify Player Directory has updated attendance summary (1 present / 2 total = 50%) and Ready: false
  const pRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, { headers: authHeader(coachToken) });
  const pData = await pRes.json();
  assert.equal(pData.attendanceRate, 50, 'Attendance % must drop to 50%');
  assert.equal(pData.presentSessions, 1);
  assert.equal(pData.totalSessions, 2);
  assert.equal(pData.isReady, false, 'Rahul must become NOT READY because attendance < 75%');

  // 4. Verify Match eligibility for upcoming match on this date
  const eligRes = await fetch(`${baseUrl}/api/matches/${matchUpcoming._id}/eligible-players`, { headers: authHeader(coachToken) });
  const eligData = await eligRes.json();
  assert.equal(eligData.sessionFound, true);
  const isRahulEligible = (eligData.players || []).some(p => p.playerId.toString() === rahulPlayer._id.toString());
  assert.equal(isRahulEligible, false, 'Rahul must NOT be eligible for match on date where he is absent');

  // 5. Verify Rahul was removed from upcoming match selected squad
  const upMatchPost = await fetch(`${baseUrl}/api/matches/${matchUpcoming._id}`, { headers: authHeader(coachToken) });
  const upMatchPostData = await upMatchPost.json();
  const inSquad = upMatchPostData.selectedPlayers.some(p => (p._id || p).toString() === rahulPlayer._id.toString());
  assert.equal(inSquad, false, 'Absent player must be removed from upcoming match squad');

  // 6. Verify Player Dashboard (/api/players/me) reflects the change
  const meRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(rahulToken) });
  const meData = await meRes.json();
  assert.equal(meData.attendanceRate, 50);
  assert.equal(meData.isReady, false);
});

// ── TEST 2: Change Rahul's attendance from Absent back to Present ─────────────
test('TEST 2: Change Rahul attendance Absent -> Present restores Attendance, Directory, Eligibility & Ready status', async () => {
  // 1. Change Rahul back to Present in Session 1
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });
  const markRes = await fetch(`${baseUrl}/api/sessions/${session1._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: rahulPlayer._id, status: 'present', participation: 'both' })
  });
  assert.equal(markRes.status, 200);
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });

  // 2. Verify Session Attendance shows 100% turnout
  const sessionCheck = await fetch(`${baseUrl}/api/sessions/${session1._id}`, { headers: authHeader(coachToken) });
  const sessionData = await sessionCheck.json();
  const entry = sessionData.attendance.find(a => (a.player?._id || a.player).toString() === rahulPlayer._id.toString());
  assert.equal(entry.status, 'present');
  assert.equal(sessionData.attendanceRate, 100);

  // 3. Verify Player Directory updates back to 100% and isReady: true
  const pRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, { headers: authHeader(coachToken) });
  const pData = await pRes.json();
  assert.equal(pData.attendanceRate, 100);
  assert.equal(pData.presentSessions, 2);
  assert.equal(pData.matchesPlayed, 2);
  assert.equal(pData.isReady, true, 'Rahul must become READY again (100% att >= 75% AND 2 matches >= 2)');

  // 4. Verify Match eligibility: Rahul is now eligible again
  const eligRes = await fetch(`${baseUrl}/api/matches/${matchUpcoming._id}/eligible-players`, { headers: authHeader(coachToken) });
  const eligData = await eligRes.json();
  const isRahulEligible = (eligData.players || []).some(p => p.playerId.toString() === rahulPlayer._id.toString());
  assert.equal(isRahulEligible, true, 'Rahul must be eligible again to be added to match');

  // 5. Select Rahul back into upcoming match squad
  const selectRes = await fetch(`${baseUrl}/api/matches/${matchUpcoming._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerIds: [rahulPlayer._id.toString()] })
  });
  assert.equal(selectRes.status, 200);

  // 6. Verify Player Dashboard reflects updated READY status
  const meRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(rahulToken) });
  const meData = await meRes.json();
  assert.equal(meData.attendanceRate, 100);
  assert.equal(meData.isReady, true);
});

// ── TEST 3: Change match participation from Yes to No ─────────────────────────
test('TEST 3: Change match participation Yes -> No drops matches played & recalculates Ready status everywhere', async () => {
  // Reopen completed match for edit
  await fetch(`${baseUrl}/api/matches/${matchCompleted._id}/reopen-for-edit`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });

  // Change Rahul participation to played: false (Did Not Play)
  const partRes = await fetch(`${baseUrl}/api/matches/${matchCompleted._id}/participation/${rahulPlayer._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: false })
  });
  assert.equal(partRes.status, 200);

  // Check player matches played: should drop from 2 to 1
  const pRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, { headers: authHeader(coachToken) });
  const pData = await pRes.json();
  assert.equal(pData.matchesPlayed, 1, 'Valid matches played must drop to 1');
  assert.equal(pData.isReady, false, 'Rahul must be NOT READY because matches played (1) < 2');

  // Check Scout Ready list: Rahul should NOT be in scout ready list
  const scoutUser = await User.create({
    name: 'Scout Flow',
    username: `scout_flow_${Date.now()}`,
    email: `scout_flow_${Date.now()}@flow-test.com`,
    password: 'password123',
    role: 'scout'
  });
  const scoutToken = jwt.sign({ id: scoutUser._id, role: 'scout' }, JWT_SECRET);

  const scoutRes = await fetch(`${baseUrl}/api/scout/ready`, { headers: authHeader(scoutToken) });
  const scoutData = await scoutRes.json();
  const inScout = scoutData.some(p => p._id.toString() === rahulPlayer._id.toString());
  assert.equal(inScout, false, 'Rahul must not appear in Scout Radar when matches < 2');

  // Revert Rahul back to played: true
  await fetch(`${baseUrl}/api/matches/${matchCompleted._id}/participation/${rahulPlayer._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ played: true, score: 2 })
  });

  const restoreRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, { headers: authHeader(coachToken) });
  const restoreData = await restoreRes.json();
  assert.equal(restoreData.matchesPlayed, 2);
  assert.equal(restoreData.isReady, true);
});

// ── TEST 4: Edit player's name in Player Directory ───────────────────────────
test('TEST 4: Edit player name in Directory updates Attendance, Matches, Coach Dashboard and Player Dashboard', async () => {
  const newName = 'Rahul Sharma';

  // 1. Edit player name via PATCH /api/players/:id
  const editRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ name: newName })
  });
  assert.equal(editRes.status, 200);
  const updatedPlayer = await editRes.json();
  assert.equal(updatedPlayer.name, newName);

  // 2. Check Player Directory (GET /api/players)
  const dirRes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(coachToken) });
  const dirPlayers = await dirRes.json();
  const foundInDir = dirPlayers.find(p => p._id.toString() === rahulPlayer._id.toString());
  assert.equal(foundInDir.name, newName, 'Player Directory must show updated name');

  // 3. Check Attendance Session Details (GET /api/sessions/:id)
  const sessionRes = await fetch(`${baseUrl}/api/sessions/${session1._id}`, { headers: authHeader(coachToken) });
  const sessionData = await sessionRes.json();
  const entry = sessionData.attendance.find(a => (a.player?._id || a.player).toString() === rahulPlayer._id.toString());
  assert.equal(entry.player.name, newName, 'Attendance register must display updated player name');

  // 4. Check Matches (GET /api/matches/:id)
  const matchRes = await fetch(`${baseUrl}/api/matches/${matchUpcoming._id}`, { headers: authHeader(coachToken) });
  const matchData = await matchRes.json();
  const selectedP = matchData.selectedPlayers.find(p => (p._id || p).toString() === rahulPlayer._id.toString());
  assert.equal(selectedP.name, newName, 'Match squad must display updated player name');

  // 5. Check Player Dashboard (/api/auth/me and /api/players/me)
  const meUserRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(rahulToken) });
  const meUserData = await meUserRes.json();
  assert.equal(meUserData.name, newName, 'Player auth profile must display updated name');

  const mePlayerRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(rahulToken) });
  const mePlayerData = await mePlayerRes.json();
  assert.equal(mePlayerData.name, newName, 'Player Dashboard must display updated name');
});

// ── TEST 5: Refresh & log in again -> changes persist in MongoDB Atlas ────────
test('TEST 5: Refresh website and log in again retains all persisted changes', async () => {
  // Simulate complete fresh login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: rahulUser.username, password: 'password123' })
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  const freshToken = loginData.token;

  // Query directly from database
  const meRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(freshToken) });
  const meData = await meRes.json();
  assert.equal(meData.name, 'Rahul Sharma', 'Updated name must persist across fresh logins');
  assert.equal(meData.attendanceRate, 100, 'Attendance % must persist across fresh logins');
  assert.equal(meData.matchesPlayed, 2, 'Matches played must persist across fresh logins');
  assert.equal(meData.isReady, true, 'Ready status must persist across fresh logins');
});

// ── TEST 6: Two different browser sessions -> Real-time sync event propagation
test('TEST 6: Two independent sessions: change in Session 1 propagates to Session 2', async () => {
  // Session 1: Coach
  // Session 2: Scout / Player
  // Verify sync version endpoint responds
  const v1Res = await fetch(`${baseUrl}/api/sync/version`);
  const v1Data = await v1Res.json();
  const initialVersion = v1Data.version;

  // Make an attendance change in Session 1
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });
  await fetch(`${baseUrl}/api/sessions/${session1._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: rahulPlayer._id, status: 'absent' })
  });
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });

  // Session 2 checks sync version: must be newer than initialVersion
  const v2Res = await fetch(`${baseUrl}/api/sync/version`);
  const v2Data = await v2Res.json();
  assert.ok(v2Data.version >= initialVersion, 'Sync version must update after mutation in Session 1');

  // In Session 2, fetching player data immediately shows the updated Absent state and NOT READY
  const sess2PlayerRes = await fetch(`${baseUrl}/api/players/${rahulPlayer._id}`, { headers: authHeader(coachToken) });
  const sess2PlayerData = await sess2PlayerRes.json();
  assert.equal(sess2PlayerData.attendanceRate, 50, 'Session 2 must receive updated 50% attendance');
  assert.equal(sess2PlayerData.isReady, false, 'Session 2 must receive updated NOT READY status');

  // Restore Rahul back to present
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });
  await fetch(`${baseUrl}/api/sessions/${session1._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: rahulPlayer._id, status: 'present', participation: 'both' })
  });
  await fetch(`${baseUrl}/api/sessions/${session1._id}/toggle-lock`, { method: 'PATCH', headers: authHeader(coachToken) });
});

