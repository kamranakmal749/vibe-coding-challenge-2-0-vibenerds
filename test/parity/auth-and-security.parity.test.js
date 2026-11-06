// test/parity/auth-and-security.parity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const {
  startTestServer,
  stopTestServer,
  authHeader,
  createCoachFixture,
  createAdminFixture,
  createScoutFixture,
  createPlayerTeamFixture,
  JWT_SECRET,
  User,
  Player
} = require('./parity-helpers');

let baseUrl;

test.before(async () => {
  baseUrl = await startTestServer();
});

test.after(async () => {
  await stopTestServer();
});

test('PARITY - Auth: JWT validation matrix (missing token, invalid token, deleted user, deleted player, password change gate)', async () => {
  const { coach, token: coachToken } = await createCoachFixture('jwt_auth_matrix');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 2);
  const p1 = players[0];

  // 1. Missing Authorization header -> 401
  const noHeaderRes = await fetch(`${baseUrl}/api/players`);
  assert.equal(noHeaderRes.status, 401);
  const noHeaderData = await noHeaderRes.json();
  assert.equal(noHeaderData.error, 'No token provided');

  // 2. Invalid or tampered token -> 401
  const badTokenRes = await fetch(`${baseUrl}/api/players`, {
    headers: { Authorization: 'Bearer this-is-not-a-valid-jwt-token' }
  });
  assert.equal(badTokenRes.status, 401);
  const badTokenData = await badTokenRes.json();
  assert.equal(badTokenData.error, 'Invalid or expired token');

  // 3. Player account deleted -> 401 on player requests
  const pUser1 = await User.create({
    name: p1.name,
    username: `user_${p1._id}`,
    email: `p1_${p1._id}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: p1._id
  });
  const pToken1 = jwt.sign({ id: pUser1._id, role: 'player', playerId: p1._id }, JWT_SECRET);

  // Valid before deletion
  const validRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(pToken1) });
  assert.equal(validRes.status, 200);

  // Delete user document
  await User.findByIdAndDelete(pUser1._id);
  const deletedUserRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(pToken1) });
  assert.equal(deletedUserRes.status, 401);
  const deletedUserData = await deletedUserRes.json();
  assert.equal(deletedUserData.error, 'Account has been removed');

  // 4. Player profile document deleted -> 401
  const p2 = players[1];
  const pUser2 = await User.create({
    name: p2.name,
    username: `user_${p2._id}`,
    email: `p2_${p2._id}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: p2._id
  });
  const pToken2 = jwt.sign({ id: pUser2._id, role: 'player', playerId: p2._id }, JWT_SECRET);

  // Delete Player document
  await Player.findByIdAndDelete(p2._id);
  const deletedPlayerRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(pToken2) });
  assert.equal(deletedPlayerRes.status, 401);
  const deletedPlayerData = await deletedPlayerRes.json();
  assert.equal(deletedPlayerData.error, 'Player profile has been removed');

  // 5. Player with mustChangePassword = true blocked on regular routes (403), allowed on /me and /change-password
  const pUser3 = await User.create({
    name: 'PwChange Player',
    username: `pwchange_${Date.now()}`,
    email: `pwchange_${Date.now()}@test.com`,
    password: 'tempPassword123',
    role: 'player',
    playerId: p1._id,
    mustChangePassword: true
  });
  const pToken3 = jwt.sign({ id: pUser3._id, role: 'player', playerId: p1._id, mustChangePassword: true }, JWT_SECRET);

  // Accessing /api/players returns 403
  const blockedRes = await fetch(`${baseUrl}/api/players`, { headers: authHeader(pToken3) });
  assert.equal(blockedRes.status, 403);
  const blockedData = await blockedRes.json();
  assert.equal(blockedData.mustChangePassword, true);

  // Accessing /api/auth/me is exempt (returns 200)
  const exemptRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(pToken3) });
  assert.equal(exemptRes.status, 200);
});

test('PARITY - Roles: Role matrix 403s on routers (players, sessions, matches, scout, auth)', async () => {
  const { coach, token: coachToken } = await createCoachFixture('roles_matrix_coach');
  const { scout, token: scoutToken } = await createScoutFixture();
  const players = await createPlayerTeamFixture(coach._id, 'Football', 2);
  const p = players[0];

  const pUser = await User.create({
    name: p.name,
    username: `player_${p._id}`,
    email: `player_${p._id}@test.com`,
    password: 'password123',
    role: 'player',
    playerId: p._id
  });
  const playerToken = jwt.sign({ id: pUser._id, role: 'player', playerId: p._id }, JWT_SECRET);

  // 1. Scout cannot mutate players, sessions, or matches
  const scoutCreatePlayerRes = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: authHeader(scoutToken),
    body: JSON.stringify({ name: 'Scout Player', age: 15, sport: 'Football' })
  });
  assert.equal(scoutCreatePlayerRes.status, 403);

  const scoutCreateSessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(scoutToken),
    body: JSON.stringify({ date: '2026-11-01', sport: 'Football' })
  });
  assert.equal(scoutCreateSessionRes.status, 403);

  const scoutCreateMatchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(scoutToken),
    body: JSON.stringify({ title: 'Scout Match', sport: 'Football', date: '2026-11-01', time: '17:00', opponent: 'Opp', venue: 'V' })
  });
  assert.equal(scoutCreateMatchRes.status, 403);

  // 2. Player cannot mutate sessions or matches
  const playerCreateSessionRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(playerToken),
    body: JSON.stringify({ date: '2026-11-01', sport: 'Football' })
  });
  assert.equal(playerCreateSessionRes.status, 403);

  const playerCreateMatchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(playerToken),
    body: JSON.stringify({ title: 'Player Match', sport: 'Football', date: '2026-11-01', time: '17:00', opponent: 'Opp', venue: 'V' })
  });
  assert.equal(playerCreateMatchRes.status, 403);

  // Player cannot access scout endpoints
  const playerScoutRes = await fetch(`${baseUrl}/api/scout/ready`, {
    headers: authHeader(playerToken)
  });
  assert.equal(playerScoutRes.status, 403);

  // 3. Coach cannot access admin-only endpoints (e.g. GET /api/auth/coaches or DELETE /api/players/:id)
  const coachCoachesRes = await fetch(`${baseUrl}/api/auth/coaches`, {
    headers: authHeader(coachToken)
  });
  assert.equal(coachCoachesRes.status, 403);

  const coachDeletePlayerRes = await fetch(`${baseUrl}/api/players/${p._id}`, {
    method: 'DELETE',
    headers: authHeader(coachToken)
  });
  assert.equal(coachDeletePlayerRes.status, 403);
});

test('PARITY - Auth: Full auth lifecycle (login, me, change-password, player-account, coaches) and health check', async () => {
  const { admin, token: adminToken } = await createAdminFixture();
  const { coach, token: coachToken } = await createCoachFixture('auth_lifecycle_coach');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 2);
  const p = players[0];

  // 1. GET /api/health -> 200 { status: 'ok' }
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.status, 'ok');

  // 2. GET /api/auth/coaches (Admin only) -> 200 array containing coach
  const coachesRes = await fetch(`${baseUrl}/api/auth/coaches`, { headers: authHeader(adminToken) });
  assert.equal(coachesRes.status, 200);
  const coachesList = await coachesRes.json();
  assert.ok(Array.isArray(coachesList));
  assert.ok(coachesList.some(c => c._id.toString() === coach._id.toString()));

  // 3. POST /api/auth/login with invalid credentials -> 401
  const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: coach.username, password: 'wrongpassword' })
  });
  assert.equal(badLoginRes.status, 401);

  // POST /api/auth/login with valid credentials -> 200 + token + user
  const goodLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: coach.username, password: 'password123' })
  });
  assert.equal(goodLoginRes.status, 200);
  const loginData = await goodLoginRes.json();
  assert.ok(loginData.token);
  assert.equal(loginData.user.id.toString(), coach._id.toString());
  assert.equal(loginData.user.role, 'coach');

  // 4. GET /api/auth/me returns authenticated user info
  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(loginData.token) });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData._id.toString(), coach._id.toString());
  assert.equal(meData.username, coach.username);

  // 5. POST /api/auth/player-account creates login credentials for player
  const paRes = await fetch(`${baseUrl}/api/auth/player-account`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: p._id.toString(), password: 'newplayerpass123' })
  });
  assert.equal(paRes.status, 201);
  const paData = await paRes.json();
  assert.equal(paData.user.playerId.toString(), p._id.toString());

  // Duplicate player-account -> 409
  const dupPaRes = await fetch(`${baseUrl}/api/auth/player-account`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({ playerId: p._id.toString(), password: 'anotherpass' })
  });
  assert.equal(dupPaRes.status, 409);

  // 6. Login as newly created player
  const playerLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: paData.user.username, password: 'newplayerpass123' })
  });
  assert.equal(playerLoginRes.status, 200);
  const playerLogin = await playerLoginRes.json();

  // PATCH /api/auth/change-password
  // Same password -> 400
  const samePwRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'PATCH',
    headers: authHeader(playerLogin.token),
    body: JSON.stringify({ currentPassword: 'newplayerpass123', newPassword: 'newplayerpass123' })
  });
  assert.equal(samePwRes.status, 400);

  // Update password successfully -> 200 + new token
  const updatePwRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'PATCH',
    headers: authHeader(playerLogin.token),
    body: JSON.stringify({ currentPassword: 'newplayerpass123', newPassword: 'brandNewPassword456' })
  });
  assert.equal(updatePwRes.status, 200);
  const updatedPwData = await updatePwRes.json();
  assert.ok(updatedPwData.token);
  assert.equal(updatedPwData.user.mustChangePassword, false);

  // Login with new password works
  const reLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: paData.user.username, password: 'brandNewPassword456' })
  });
  assert.equal(reLoginRes.status, 200);
});
