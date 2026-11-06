// test/player-removal.test.js
// Verification suite for secure, permanent player removal in MaidanDesk
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('../src/models/User');
const Player = require('../src/models/Player');
const Session = require('../src/models/Session');
const Match = require('../src/models/Match');
const MatchParticipation = require('../src/models/MatchParticipation');

const BASE_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let adminToken;
let coachToken;
let scoutToken;
let playerToken;
let testCoach;
let testPlayerDoc;
let testUserDoc;
let upcomingMatchDoc;
let completedMatchDoc;
let draftSessionDoc;
let savedSessionDoc;

let isConnected = false;

test.before(async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    }
    isConnected = true;
  } catch (err) {
    console.warn('[NOTICE] MongoDB Atlas unreachable on this network (port 27017 restricted):', err.message);
    return;
  }

  // Cleanup any leftover test removal documents
  await User.deleteMany({ email: { $regex: /@removal-test\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^RemovalTest_/ } });
  await Match.deleteMany({ sport: 'RemovalSport' });
  await Session.deleteMany({ sport: 'RemovalSport' });

  // 1. Setup Admin User
  const adminUser = await User.create({
    name: 'Removal Admin',
    email: 'admin@removal-test.com',
    role: 'admin',
    password: 'password123'
  });
  adminToken = jwt.sign({ id: adminUser._id, name: adminUser.name, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

  // 2. Setup Coach User
  testCoach = await User.create({
    name: 'Removal Coach',
    email: 'coach@removal-test.com',
    role: 'coach',
    password: 'password123'
  });
  coachToken = jwt.sign({ id: testCoach._id, name: testCoach.name, role: 'coach' }, JWT_SECRET, { expiresIn: '1h' });

  // 3. Setup Scout User
  const scoutUser = await User.create({
    name: 'Removal Scout',
    email: 'scout@removal-test.com',
    role: 'scout',
    password: 'password123'
  });
  scoutToken = jwt.sign({ id: scoutUser._id, name: scoutUser.name, role: 'scout' }, JWT_SECRET, { expiresIn: '1h' });

  // 4. Setup Test Player & Linked User
  testPlayerDoc = await Player.create({
    name: 'RemovalTest_Athlete_Alpha',
    age: 18,
    sport: 'RemovalSport',
    registeredOn: new Date(),
    coach: testCoach._id,
    defaultParticipation: 'both'
  });

  testUserDoc = await User.create({
    name: 'RemovalTest_Athlete_Alpha',
    email: 'alpha@removal-test.com',
    username: (testPlayerDoc.playerId || testPlayerDoc._id.toString()).toLowerCase(),
    role: 'player',
    playerId: testPlayerDoc._id,
    password: 'password123'
  });

  playerToken = jwt.sign({
    id: testUserDoc._id,
    name: testUserDoc.name,
    role: 'player',
    playerId: testPlayerDoc._id
  }, JWT_SECRET, { expiresIn: '1h' });

  // Setup second player to verify partner history remains intact
  const partnerPlayer = await Player.create({
    name: 'RemovalTest_Athlete_Beta',
    age: 19,
    sport: 'RemovalSport',
    registeredOn: new Date(),
    coach: testCoach._id,
    defaultParticipation: 'both'
  });

  // 5. Setup Draft / Mutable Session containing test player
  draftSessionDoc = await Session.create({
    coach: testCoach._id,
    sport: 'RemovalSport',
    date: new Date(),
    saved: false,
    locked: false,
    initialRosterPlayerIds: [testPlayerDoc._id, partnerPlayer._id],
    attendance: [
      { player: testPlayerDoc._id, status: 'present', participation: 'both' },
      { player: partnerPlayer._id, status: 'present', participation: 'both' }
    ]
  });

  // 6. Setup Saved Historical Session containing test player
  savedSessionDoc = await Session.create({
    coach: testCoach._id,
    sport: 'RemovalSport',
    date: new Date(Date.now() - 86400000 * 2),
    saved: true,
    locked: true,
    initialRosterPlayerIds: [testPlayerDoc._id, partnerPlayer._id],
    attendance: [
      { player: testPlayerDoc._id, status: 'present', participation: 'both' },
      { player: partnerPlayer._id, status: 'present', participation: 'both' }
    ]
  });

  // 7. Setup Upcoming Match containing test player
  upcomingMatchDoc = await Match.create({
    coach: testCoach._id,
    sport: 'RemovalSport',
    opponent: 'Upcoming Opponent FC',
    date: new Date(Date.now() + 86400000 * 3),
    status: 'upcoming',
    selectedPlayers: [testPlayerDoc._id, partnerPlayer._id]
  });
  await MatchParticipation.create([
    { match: upcomingMatchDoc._id, player: testPlayerDoc._id, sport: 'RemovalSport', played: null },
    { match: upcomingMatchDoc._id, player: partnerPlayer._id, sport: 'RemovalSport', played: null }
  ]);

  // 8. Setup Completed Historical Match containing test player & partner
  completedMatchDoc = await Match.create({
    coach: testCoach._id,
    sport: 'RemovalSport',
    opponent: 'Historical Rivals',
    date: new Date(Date.now() - 86400000 * 5),
    status: 'completed',
    selectedPlayers: [testPlayerDoc._id, partnerPlayer._id],
    entries: [
      { player: testPlayerDoc._id, result: 'played', score: 10 },
      { player: partnerPlayer._id, result: 'played', score: 25 }
    ]
  });
  await MatchParticipation.create([
    { match: completedMatchDoc._id, player: testPlayerDoc._id, sport: 'RemovalSport', played: true, score: 10, remarks: 'Key goal' },
    { match: completedMatchDoc._id, player: partnerPlayer._id, sport: 'RemovalSport', played: true, score: 25, remarks: 'Player of match' }
  ]);
});

test.after(async () => {
  if (!isConnected) return;
  await User.deleteMany({ email: { $regex: /@removal-test\.com$/ } });
  await Player.deleteMany({ name: { $regex: /^RemovalTest_/ } });
  await Match.deleteMany({ sport: 'RemovalSport' });
  await Session.deleteMany({ sport: 'RemovalSport' });
  await MatchParticipation.deleteMany({ sport: 'RemovalSport' });
  await mongoose.disconnect();
});

test('1. Role Authorization: Coach cannot delete player', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/players/${testPlayerDoc._id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${coachToken}` }
  });
  assert.equal(res.status, 403, 'Coach role must receive 403 Forbidden');
});

test('2. Role Authorization: Scout cannot delete player', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/players/${testPlayerDoc._id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${scoutToken}` }
  });
  assert.equal(res.status, 403, 'Scout role must receive 403 Forbidden');
});

test('3. Role Authorization: Player cannot delete themselves', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/players/${testPlayerDoc._id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${playerToken}` }
  });
  assert.equal(res.status, 403, 'Player role must receive 403 Forbidden');
});

test('4. Admin deletes player: succeeds and returns 200', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/players/${testPlayerDoc._id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200, 'Admin deletion should return HTTP 200');
  const data = await res.json();
  assert.equal(data.playerId, testPlayerDoc._id.toString());
});

test('5. Verify Player document is permanently deleted from MongoDB', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const check = await Player.findById(testPlayerDoc._id);
  assert.equal(check, null, 'Player document must no longer exist');
});

test('6. Verify linked User account is permanently deleted', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const check = await User.findById(testUserDoc._id);
  assert.equal(check, null, 'Linked User account must be permanently deleted');
});

test('7. Verify existing JWT token for deleted player is rejected with 401', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/players/me`, {
    headers: { 'Authorization': `Bearer ${playerToken}` }
  });
  assert.equal(res.status, 401, 'Existing JWT for deleted player must be rejected with 401');
  const data = await res.json();
  assert.match(data.error, /removed/i, 'Error message should indicate account or profile removal');
});

test('8. Verify draft session roster had deleted player removed', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const updatedDraft = await Session.findById(draftSessionDoc._id);
  assert.ok(updatedDraft, 'Draft session exists');
  const hasPlayerInRoster = (updatedDraft.initialRosterPlayerIds || []).some(id => id.toString() === testPlayerDoc._id.toString());
  const hasPlayerInAttendance = (updatedDraft.attendance || []).some(a => (a.player?._id || a.player)?.toString() === testPlayerDoc._id.toString());
  assert.equal(hasPlayerInRoster, false, 'Deleted player removed from initialRosterPlayerIds in draft session');
  assert.equal(hasPlayerInAttendance, false, 'Deleted player removed from attendance in draft session');
});

test('9. Verify saved historical session survives with null-safety and no errors', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/sessions/${savedSessionDoc._id}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200, 'Saved historical session must load cleanly with HTTP 200');
  const data = await res.json();
  assert.ok(Array.isArray(data.session.attendance), 'Session attendance is returned as array');
  assert.equal(data.session.attendance.length, 2, 'Historical attendance entry count is preserved');
});

test('10. Verify upcoming match had deleted player removed', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/matches/${upcomingMatchDoc._id}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  const selectedPids = (data.selectedPlayers || []).map(p => (p._id || p).toString());
  assert.equal(selectedPids.includes(testPlayerDoc._id.toString()), false, 'Deleted player removed from upcoming match selectedPlayers');
});

test('11. Verify completed historical match fixture, score, and opponent remain 100% intact', async (t) => {
  if (!isConnected) return t.skip('MongoDB Atlas port 27017 restricted on current network');
  const res = await fetch(`${BASE_URL}/api/matches/${completedMatchDoc._id}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.opponent, 'Historical Rivals', 'Historical opponent preserved');
  assert.equal(data.status, 'completed', 'Match completed status preserved');
  assert.ok(data.entries.length >= 2, 'Historical match entries preserved');

  // Verify participation endpoint handles deleted player without throwing
  const partRes = await fetch(`${BASE_URL}/api/matches/${completedMatchDoc._id}/participation`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(partRes.status, 200);
  const partData = await partRes.json();
  assert.ok(Array.isArray(partData.participations));
  const deletedEntry = partData.participations.find(p => p.name === 'Deleted Player' || p.playerId === testPlayerDoc._id.toString());
  assert.ok(deletedEntry, 'Historical participation record safely preserved as Deleted Player');
  assert.equal(deletedEntry.played, true, 'Played status preserved');
  assert.equal(deletedEntry.score, 10, 'Historical score preserved');
});
