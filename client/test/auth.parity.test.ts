// client/test/auth.parity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const User = require('../src/lib/models/User');
const Player = require('../src/lib/models/Player');

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

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

test('AUTH - Full JWT validation matrix on Next.js auth routes', async () => {
  const coach = await User.create({
    name: 'Test Coach',
    username: `coach_${Date.now()}`,
    email: `coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const coachToken = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);

  // 1. Missing Authorization header -> 401
  const noHeaderRes = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(noHeaderRes.status, 401);
  const noHeaderData = await noHeaderRes.json();
  assert.equal(noHeaderData.error, 'No token provided');

  // 2. Invalid or tampered token -> 401
  const badTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: 'Bearer this-is-not-a-valid-jwt-token' }
  });
  assert.equal(badTokenRes.status, 401);
  const badTokenData = await badTokenRes.json();
  assert.equal(badTokenData.error, 'Invalid or expired token');

  // 3. Player User deleted -> 401
  const doomedPlayerForUser = await Player.create({
    name: 'Doomed Player For User',
    sport: 'Football',
    age: 15,
    coach: coach._id
  });
  const doomedUser = await User.create({
    name: 'Doomed Player User',
    username: `doomed_${Date.now()}`,
    email: `doomed_${Date.now()}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: doomedPlayerForUser._id
  });
  const doomedToken = jwt.sign({ id: doomedUser._id, role: 'player', playerId: doomedPlayerForUser._id }, JWT_SECRET);
  await User.findByIdAndDelete(doomedUser._id);

  const deletedUserRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(doomedToken) });
  assert.equal(deletedUserRes.status, 401);
  const deletedUserData = await deletedUserRes.json();
  assert.equal(deletedUserData.error, 'Account has been removed');

  // 4. Player document deleted -> 401
  const doomedPlayer = await Player.create({
    name: 'Doomed Player',
    sport: 'Football',
    age: 16,
    coach: coach._id
  });
  const playerUser = await User.create({
    name: doomedPlayer.name,
    username: `player_${doomedPlayer._id}`,
    email: `player_${doomedPlayer._id}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: doomedPlayer._id
  });
  const playerToken = jwt.sign({ id: playerUser._id, role: 'player', playerId: doomedPlayer._id }, JWT_SECRET);
  await Player.findByIdAndDelete(doomedPlayer._id);

  const deletedPlayerRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(playerToken) });
  assert.equal(deletedPlayerRes.status, 401);
  const deletedPlayerData = await deletedPlayerRes.json();
  assert.equal(deletedPlayerData.error, 'Player profile has been removed');

  // 5. Player with mustChangePassword = true blocked on regular routes (403), allowed on /me
  const forcedPwUser = await User.create({
    name: 'Forced Pw User',
    username: `forced_${Date.now()}`,
    email: `forced_${Date.now()}@test.com`,
    password: 'tempPassword123',
    role: 'player',
    playerId: doomedPlayerForUser._id,
    mustChangePassword: true
  });
  const forcedPwToken = jwt.sign({ id: forcedPwUser._id, role: 'player', playerId: doomedPlayerForUser._id, mustChangePassword: true }, JWT_SECRET);

  // Exempt on /api/auth/me -> 200
  const exemptRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(forcedPwToken) });
  assert.equal(exemptRes.status, 200);

  // Blocked on other authenticated route (e.g. /api/auth/player-account) -> 403
  const blockedRes = await fetch(`${baseUrl}/api/auth/player-account`, {
    method: 'POST',
    headers: authHeader(forcedPwToken),
    body: JSON.stringify({ playerId: new mongoose.Types.ObjectId().toString(), password: 'pass' })
  });
  assert.equal(blockedRes.status, 403);
  const blockedData = await blockedRes.json();
  assert.equal(blockedData.mustChangePassword, true);
});

test('AUTH - Role authorization matrix on Next.js auth routes', async () => {
  const admin = await User.create({
    name: 'Admin User',
    username: `admin_${Date.now()}`,
    email: `admin_${Date.now()}@test.com`,
    password: 'password123',
    role: 'admin'
  });
  const adminToken = jwt.sign({ id: admin._id, role: 'admin' }, JWT_SECRET);

  const coach = await User.create({
    name: 'Coach User',
    username: `coach_${Date.now()}`,
    email: `coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  const coachToken = jwt.sign({ id: coach._id, role: 'coach' }, JWT_SECRET);

  const scout = await User.create({
    name: 'Scout User',
    username: `scout_${Date.now()}`,
    email: `scout_${Date.now()}@test.com`,
    password: 'password123',
    role: 'scout'
  });
  const scoutToken = jwt.sign({ id: scout._id, role: 'scout' }, JWT_SECRET);

  // Admin-only: GET /api/auth/coaches
  // Admin -> 200
  const adminCoachesRes = await fetch(`${baseUrl}/api/auth/coaches`, { headers: authHeader(adminToken) });
  assert.equal(adminCoachesRes.status, 200);

  // Coach -> 403
  const coachCoachesRes = await fetch(`${baseUrl}/api/auth/coaches`, { headers: authHeader(coachToken) });
  assert.equal(coachCoachesRes.status, 403);

  // Scout -> 403
  const scoutCoachesRes = await fetch(`${baseUrl}/api/auth/coaches`, { headers: authHeader(scoutToken) });
  assert.equal(scoutCoachesRes.status, 403);

  // Coach or Admin: POST /api/auth/player-account
  // Scout -> 403
  const scoutCreatePlayerRes = await fetch(`${baseUrl}/api/auth/player-account`, {
    method: 'POST',
    headers: authHeader(scoutToken),
    body: JSON.stringify({ playerId: new mongoose.Types.ObjectId().toString(), password: 'pass' })
  });
  assert.equal(scoutCreatePlayerRes.status, 403);
});
