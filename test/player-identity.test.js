// test/player-identity.test.js
// Unit & Integration tests for Part 2: Unique Player Identity & Username Login
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const Player = require('../src/models/Player');
const Counter = require('../src/models/Counter');
const { generatePlayerId } = require('../src/utils/idGenerator');
const migratePlayerUsernames = require('../scripts/migrate-player-usernames');

let server;
let baseUrl;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  // Clean test namespace counters
  await Counter.deleteMany({ key: { $in: ['player_28', 'player_24', 'player_29'] } });
});

test.after(async () => {
  await Counter.deleteMany({ key: { $in: ['player_28', 'player_24', 'player_29'] } });
  if (server) server.close();
  await mongoose.disconnect();
});

test('1. Concurrent player ID generation has zero collisions', async () => {
  const promises = [];
  const count = 30;
  for (let i = 0; i < count; i++) {
    promises.push(generatePlayerId(new Date('2028-05-01')));
  }
  const results = await Promise.all(promises);
  assert.equal(results.length, count);
  const uniqueSet = new Set(results);
  assert.equal(uniqueSet.size, count, 'Every generated ID must be unique even under high concurrency');
  for (const id of results) {
    assert.match(id, /^md28\d{4}$/, 'ID must match md28XXXX format');
  }
});

test('2. Cross-year sequence resets correctly per year', async () => {
  const id2024 = await generatePlayerId(new Date('2024-03-15'));
  const id2029 = await generatePlayerId(new Date('2029-11-20'));
  const id2024_second = await generatePlayerId(new Date('2024-08-10'));

  assert.equal(id2024, 'md240001', 'First ID for 2024 must start at md240001');
  assert.equal(id2029, 'md290001', 'First ID for 2029 must start at md290001');
  assert.equal(id2024_second, 'md240002', 'Second ID for 2024 must increment to md240002');
});

test('3. Login works via username (md-code) and via email, and fails cleanly on wrong password', async () => {
  // Create test coach
  const coach = await User.create({
    name: 'Test Identity Coach',
    username: `idcoach_${Date.now()}`,
    email: `idcoach_${Date.now()}@maidandesk.com`,
    password: 'coachpassword123',
    role: 'coach'
  });

  // Create test player (auto-generates playerId e.g. md26XXXX)
  const player = await Player.create({
    name: 'Identity Test Athlete',
    age: 18,
    sport: 'Football',
    registeredOn: new Date('2026-06-15'),
    coach: coach._id
  });

  assert.ok(player.playerId, 'Player must have auto-assigned playerId');
  assert.match(player.playerId, /^md26\d{4}$/, 'Player ID must match md26XXXX');

  const playerEmail = `athlete_${Date.now()}@player.com`;
  const playerPassword = 'athleteSecret123';

  // Create matching User
  const playerUser = await User.create({
    name: player.name,
    username: player.playerId,
    email: playerEmail,
    password: playerPassword,
    role: 'player',
    playerId: player._id
  });

  // A. Login via username (md-code)
  const userRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: player.playerId, password: playerPassword })
  });
  assert.equal(userRes.status, 200, 'Login via md-code username should succeed');
  const userData = await userRes.json();
  assert.ok(userData.token);
  assert.equal(userData.user.username, player.playerId);

  // B. Login via email
  const emailRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: playerEmail, password: playerPassword })
  });
  assert.equal(emailRes.status, 200, 'Login via email should succeed');
  const emailData = await emailRes.json();
  assert.ok(emailData.token);
  assert.equal(emailData.user.username, player.playerId);

  // C. Login with wrong password fails cleanly
  const wrongRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: player.playerId, password: 'wrongPassword999' })
  });
  assert.equal(wrongRes.status, 401, 'Wrong password must return 401');
  const wrongData = await wrongRes.json();
  assert.equal(wrongData.error, 'Invalid credentials', 'Generic invalid credentials error must be returned');

  // D. Coach login unchanged using email
  const coachRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: coach.email, password: 'coachpassword123' })
  });
  assert.equal(coachRes.status, 200, 'Coach login via email unchanged');

  // Cleanup
  await User.findByIdAndDelete(coach._id);
  await User.findByIdAndDelete(playerUser._id);
  await Player.findByIdAndDelete(player._id);
});

test('4. Player account creation rejects non-existent player', async () => {
  const coach = await User.create({
    name: 'Account Test Coach',
    username: `acctcoach_${Date.now()}`,
    email: `acctcoach_${Date.now()}@maidandesk.com`,
    password: 'password123',
    role: 'coach'
  });
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: coach._id, role: 'coach' }, process.env.JWT_SECRET);

  const fakeId = new mongoose.Types.ObjectId();
  const res = await fetch(`${baseUrl}/api/auth/player-account`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      playerId: fakeId.toString(),
      password: 'player123'
    })
  });
  assert.equal(res.status, 404, 'Must reject account creation for non-existent player');

  await User.findByIdAndDelete(coach._id);
});

test('5. Migration script is idempotent on repeat runs', async () => {
  const result1 = await migratePlayerUsernames();
  assert.ok(result1 !== undefined);

  // Second run must update 0 players
  const result2 = await migratePlayerUsernames();
  assert.equal(result2.assignedCount, 0, 'Second migration run must be a no-op (idempotent)');
});

