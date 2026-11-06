// client/test/players.parity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const User = require('../src/lib/models/User');
const Player = require('../src/lib/models/Player');
const Session = require('../src/lib/models/Session');
const Match = require('../src/lib/models/Match');
const MatchParticipation = require('../src/lib/models/MatchParticipation');

function authHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(parityUri);
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

test('PLAYERS - Full lifecycle (CRUD, auto-sync, /me, cross-coach 403, idempotency)', async () => {
  // 1. Setup Coach A and Coach B
  const coachA = await User.create({
    name: 'Coach Alpha',
    username: `coach_a_${Date.now()}`,
    email: `coach_a_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const tokenA = jwt.sign({ id: coachA._id, role: 'coach' }, JWT_SECRET);

  const coachB = await User.create({
    name: 'Coach Beta',
    username: `coach_b_${Date.now()}`,
    email: `coach_b_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const tokenB = jwt.sign({ id: coachB._id, role: 'coach' }, JWT_SECRET);

  const admin = await User.create({
    name: 'Admin Boss',
    username: `admin_${Date.now()}`,
    email: `admin_${Date.now()}@test.com`,
    password: 'password123',
    role: 'admin'
  });
  const adminToken = jwt.sign({ id: admin._id, role: 'admin' }, JWT_SECRET);

  // Active unsaved draft session for Coach A
  const draftSessionA = await Session.create({
    coach: coachA._id,
    sport: 'Football',
    date: new Date('2026-11-01T00:00:00.000Z'),
    saved: false,
    locked: false,
    attendance: []
  });

  // 2. POST /api/players validation failures
  const badAgeRes = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({ name: 'Young Kid', age: 2, sport: 'Football' })
  });
  assert.equal(badAgeRes.status, 400);
  const badAgeData = await badAgeRes.json();
  assert.equal(badAgeData.error, 'Age must be a number between 5 and 50');

  // 3. POST /api/players create player by Coach A
  const createRes = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: {
      ...authHeader(tokenA),
      'x-idempotency-key': `idem_${Date.now()}`
    },
    body: JSON.stringify({
      name: 'Player One',
      age: 16,
      sport: 'Football',
      defaultParticipation: 'both'
    })
  });
  assert.equal(createRes.status, 201);
  const createdPlayer = await createRes.json();
  assert.ok(createdPlayer._id);
  assert.ok(createdPlayer.playerId);
  assert.ok(createdPlayer.credentials.temporaryPassword);
  assert.equal(createdPlayer.credentials.mustChangePassword, true);

  // 4. Verify player was auto-synced to active draft session
  const reloadedSession = await Session.findById(draftSessionA._id);
  assert.ok(
    reloadedSession.attendance.some((a: any) => a.player.toString() === createdPlayer._id.toString()),
    'New player must be auto-synced to active draft session'
  );

  // 5. GET /api/players - Coach A sees player, Coach B does NOT see Coach A player
  const listARes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(tokenA) });
  assert.equal(listARes.status, 200);
  const listA = await listARes.json();
  assert.ok(listA.some((p: any) => p._id.toString() === createdPlayer._id.toString()));

  const listBRes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(tokenB) });
  assert.equal(listBRes.status, 200);
  const listB = await listBRes.json();
  assert.ok(!listB.some((p: any) => p._id.toString() === createdPlayer._id.toString()));

  // 6. GET /api/players/:id by id, playerId, and username
  const getByIdRes = await fetch(`${baseUrl}/api/players/${createdPlayer._id}`, { headers: authHeader(tokenA) });
  assert.equal(getByIdRes.status, 200);
  const getById = await getByIdRes.json();
  assert.equal(getById._id.toString(), createdPlayer._id.toString());

  const getByPlayerIdRes = await fetch(`${baseUrl}/api/players/${createdPlayer.playerId}`, { headers: authHeader(tokenA) });
  assert.equal(getByPlayerIdRes.status, 200);

  // 7. GET /api/players/me using Player login token (after password set)
  const playerUser = await User.findOne({ playerId: createdPlayer._id });
  playerUser.mustChangePassword = false;
  await playerUser.save();

  const playerToken = jwt.sign(
    { id: playerUser._id, role: 'player', playerId: createdPlayer._id, mustChangePassword: false },
    JWT_SECRET
  );
  const meRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(playerToken) });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData._id.toString(), createdPlayer._id.toString());

  // 8. Cross-coach 403 on PATCH
  const coachBPatchRes = await fetch(`${baseUrl}/api/players/${createdPlayer._id}`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ name: 'Hacked Name' })
  });
  assert.equal(coachBPatchRes.status, 403);

  // 9. PATCH /api/players/:id by Coach A
  const patchRes = await fetch(`${baseUrl}/api/players/${createdPlayer._id}`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({ name: 'Player One Updated', age: 17 })
  });
  assert.equal(patchRes.status, 200);
  const updatedPlayer = await patchRes.json();
  assert.equal(updatedPlayer.name, 'Player One Updated');
  assert.equal(updatedPlayer.age, 17);

  // Verify name was synchronized to User document
  const reloadedUser = await User.findOne({ playerId: createdPlayer._id });
  assert.equal(reloadedUser.name, 'Player One Updated');

  // 10. PUT /api/players/:id alias works
  const putRes = await fetch(`${baseUrl}/api/players/${createdPlayer._id}`, {
    method: 'PUT',
    headers: authHeader(tokenA),
    body: JSON.stringify({ name: 'Player One PUT Updated' })
  });
  assert.equal(putRes.status, 200);

  // Clean up
  await Session.findByIdAndDelete(draftSessionA._id);
  await User.deleteMany({ _id: { $in: [coachA._id, coachB._id, admin._id, playerUser._id] } });
  await Player.findByIdAndDelete(createdPlayer._id);
});

test('PLAYERS - DELETE cascade (Admin only permanent deletion)', async () => {
  const admin = await User.create({
    name: 'Admin Cascade',
    username: `admin_casc_${Date.now()}`,
    email: `admin_casc_${Date.now()}@test.com`,
    password: 'password123',
    role: 'admin'
  });
  const adminToken = jwt.sign({ id: admin._id, role: 'admin' }, JWT_SECRET);

  const coach = await User.create({
    name: 'Coach Cascade',
    username: `coach_casc_${Date.now()}`,
    email: `coach_casc_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const coachToken = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);

  const player = await Player.create({
    name: 'Cascade Target',
    sport: 'Football',
    age: 18,
    coach: coach._id
  });

  const playerUser = await User.create({
    name: player.name,
    username: player.username || `player_${player._id}`,
    email: `cascade_${player._id}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: player._id
  });

  // Draft session with player
  const draftSession = await Session.create({
    coach: coach._id,
    sport: 'Football',
    date: new Date('2026-11-01T00:00:00.000Z'),
    saved: false,
    locked: false,
    attendance: [{ player: player._id, status: 'present' }],
    initialRosterPlayerIds: [player._id]
  });

  // Upcoming match with player
  const upcomingMatch = await Match.create({
    coach: coach._id,
    sport: 'Football',
    title: 'Upcoming Cascade Match',
    date: new Date('2026-11-01T00:00:00.000Z'),
    time: '18:00',
    opponent: 'Opponent',
    venue: 'Venue',
    status: 'upcoming',
    selectedPlayers: [player._id]
  });

  // Completed historical match with player
  const completedMatch = await Match.create({
    coach: coach._id,
    sport: 'Football',
    title: 'Completed Cascade Match',
    date: new Date('2026-10-25T00:00:00.000Z'),
    time: '18:00',
    opponent: 'Historical Opponent',
    venue: 'Venue',
    status: 'completed'
  });

  const completedPart = await MatchParticipation.create({
    match: completedMatch._id,
    player: player._id,
    played: true,
    score: 2,
    remarks: ''
  });

  // 1. Coach cannot delete player -> 403
  const coachDelRes = await fetch(`${baseUrl}/api/players/${player._id}`, {
    method: 'DELETE',
    headers: authHeader(coachToken)
  });
  assert.equal(coachDelRes.status, 403);

  // 2. Admin deletes player -> 200
  const adminDelRes = await fetch(`${baseUrl}/api/players/${player._id}`, {
    method: 'DELETE',
    headers: authHeader(adminToken)
  });
  assert.equal(adminDelRes.status, 200);

  // 3. Verify Player is deleted
  const checkPlayer = await Player.findById(player._id);
  assert.equal(checkPlayer, null);

  // 4. Verify User account is deleted
  const checkUser = await User.findById(playerUser._id);
  assert.equal(checkUser, null);

  // 5. Verify player pulled from draft session
  const checkSession = await Session.findById(draftSession._id);
  assert.ok(!checkSession.attendance.some((a: any) => a.player?.toString() === player._id.toString()));

  // 6. Verify player pulled from upcoming match
  const checkUpcoming = await Match.findById(upcomingMatch._id);
  assert.ok(!checkUpcoming.selectedPlayers.some((id: any) => id.toString() === player._id.toString()));

  // 7. Verify completed historical match participation is preserved with remark
  const checkPart = await MatchParticipation.findById(completedPart._id);
  assert.ok(checkPart, 'Historical MatchParticipation must be preserved');
  assert.equal(checkPart.remarks, 'Archived historical participant');

  // Clean up
  await MatchParticipation.findByIdAndDelete(completedPart._id);
  await Match.deleteMany({ _id: { $in: [upcomingMatch._id, completedMatch._id] } });
  await Session.findByIdAndDelete(draftSession._id);
  await User.deleteMany({ _id: { $in: [coach._id, admin._id] } });
});
