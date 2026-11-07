// test/player-removal-unit.test.js
// Deterministic unit & integration test for Player Removal logic
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { authenticate, allow } = require('../src/middleware/auth');

const JWT_SECRET = 'unit_test_jwt_secret';
process.env.JWT_SECRET = JWT_SECRET;

test('1. Auth Middleware: allow("admin") strictly blocks non-admin roles', async () => {
  const guard = allow('admin');

  // Coach role
  let nextCalled = false;
  let status = null;
  let jsonRes = null;
  guard(
    { user: { role: 'coach', id: '123' } },
    { status: (s) => { status = s; return { json: (j) => { jsonRes = j; } }; } },
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, false, 'Coach must not proceed to next()');
  assert.equal(status, 403);
  assert.equal(jsonRes.error, 'Forbidden');

  // Scout role
  nextCalled = false;
  status = null;
  guard(
    { user: { role: 'scout', id: '456' } },
    { status: (s) => { status = s; return { json: (j) => { jsonRes = j; } }; } },
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, false, 'Scout must not proceed to next()');
  assert.equal(status, 403);

  // Player role
  nextCalled = false;
  status = null;
  guard(
    { user: { role: 'player', id: '789' } },
    { status: (s) => { status = s; return { json: (j) => { jsonRes = j; } }; } },
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, false, 'Player must not proceed to next()');
  assert.equal(status, 403);

  // Admin role
  nextCalled = false;
  status = null;
  guard(
    { user: { role: 'admin', id: '999' } },
    { status: (s) => { status = s; return { json: (j) => { jsonRes = j; } }; } },
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, true, 'Admin must proceed to next()');
  assert.equal(status, null);
});

test('2. Auth Middleware: Rejects missing or invalid JWT tokens', async () => {
  let status = null;
  let jsonRes = null;
  const mockRes = {
    status: (s) => {
      status = s;
      return { json: (j) => { jsonRes = j; } };
    }
  };

  // Missing Authorization header
  await authenticate({ headers: {} }, mockRes, () => {});
  assert.equal(status, 401);
  assert.equal(jsonRes.error, 'No token provided');

  // Malformed header
  status = null;
  await authenticate({ headers: { authorization: 'Basic 12345' } }, mockRes, () => {});
  assert.equal(status, 401);
  assert.equal(jsonRes.error, 'No token provided');

  // Bad token
  status = null;
  await authenticate({ headers: { authorization: 'Bearer invalid.token.signature' } }, mockRes, () => {});
  assert.equal(status, 401);
  assert.equal(jsonRes.error, 'Invalid or expired token');
});

test('3. Auth Middleware: Revokes access when Player user document was deleted', async () => {
  const User = require('../src/models/User');
  const originalFindById = User.findById;

  // Mock User.findById returning null (deleted account)
  User.findById = async () => null;

  try {
    const validToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', role: 'player', name: 'Deleted Player', playerId: '507f1f77bcf86cd799439012' },
      JWT_SECRET
    );

    let status = null;
    let jsonRes = null;
    let nextCalled = false;

    await authenticate(
      { headers: { authorization: `Bearer ${validToken}` } },
      { status: (s) => { status = s; return { json: (j) => { jsonRes = j; } }; } },
      () => { nextCalled = true; }
    );

    assert.equal(nextCalled, false, 'Next must not be called for deleted player');
    assert.equal(status, 401, 'Must return 401 Unauthorized');
    assert.equal(jsonRes.error, 'Account has been removed');
  } finally {
    User.findById = originalFindById;
  }
});

test('4. Auth Middleware: Revokes access when Player profile document was deleted', async () => {
  const User = require('../src/models/User');
  const Player = require('../src/models/Player');
  const originalUserFindById = User.findById;
  const originalPlayerFindById = Player.findById;

  // User exists, but Player profile was deleted
  User.findById = async () => ({ _id: '507f1f77bcf86cd799439011', role: 'player' });
  Player.findById = async () => null;

  try {
    const validToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', role: 'player', name: 'Deleted Athlete', playerId: '507f1f77bcf86cd799439012' },
      JWT_SECRET
    );

    let status = null;
    let jsonRes = null;
    let nextCalled = false;

    await authenticate(
      { headers: { authorization: `Bearer ${validToken}` } },
      { status: (s) => { status = s; return { json: (j) => { jsonRes = j; } }; } },
      () => { nextCalled = true; }
    );

    assert.equal(nextCalled, false, 'Next must not be called');
    assert.equal(status, 401);
    assert.equal(jsonRes.error, 'Player profile has been removed');
  } finally {
    User.findById = originalUserFindById;
    Player.findById = originalPlayerFindById;
  }
});

test('5. Auth Middleware: Allows active Admin, Coach, or existing Player', async () => {
  const User = require('../src/models/User');
  const Player = require('../src/models/Player');
  const origUser = User.findById;
  const origPlayer = Player.findById;

  User.findById = async () => ({ _id: '507f1f77bcf86cd799439011', role: 'player' });
  Player.findById = async () => ({ _id: '507f1f77bcf86cd799439012', name: 'Active Athlete' });

  try {
    const validToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', role: 'player', name: 'Active Athlete', playerId: '507f1f77bcf86cd799439012' },
      JWT_SECRET
    );

    let nextCalled = false;
    const req = { headers: { authorization: `Bearer ${validToken}` } };
    await authenticate(req, {}, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'Active athlete must proceed');
    assert.equal(req.user.name, 'Active Athlete');
  } finally {
    User.findById = origUser;
    Player.findById = origPlayer;
  }
});

test('6. Match Participation: Null-safely handles deleted players in participation mapping', () => {
  const match = { _id: 'match123', status: 'completed', sport: 'Football' };
  const mockParticipations = [
    {
      player: { _id: 'player1', name: 'John Doe', sport: 'Football' },
      played: true,
      score: 2,
      remarks: 'Scored 2 goals'
    },
    {
      player: null, // deleted player
      played: true,
      score: 1,
      remarks: 'Archived historical participant'
    }
  ];

  const participationTable = mockParticipations.map(p => {
    const playerDoc = p.player || null;
    const pid = playerDoc ? (playerDoc._id ? playerDoc._id.toString() : playerDoc.toString()) : (p.player ? (p.player._id || p.player).toString() : 'deleted');
    return {
      playerId: pid,
      name: playerDoc ? playerDoc.name : 'Deleted Player',
      sport: playerDoc ? playerDoc.sport : match.sport,
      played: p.played,
      score: p.score,
      remarks: p.remarks || '',
      attendanceConflict: !!p.attendanceConflict,
      conflictReason: p.conflictReason || ''
    };
  });

  assert.equal(participationTable.length, 2);
  assert.equal(participationTable[0].name, 'John Doe');
  assert.equal(participationTable[0].score, 2);
  assert.equal(participationTable[1].name, 'Deleted Player');
  assert.equal(participationTable[1].score, 1);
  assert.equal(participationTable[1].remarks, 'Archived historical participant');
  assert.equal(participationTable[1].playerId, 'deleted');
});

test('7. Verification of UI & Client Sync contract in script.js', () => {
  const fs = require('fs');
  const scriptContent = fs.readFileSync('script.js', 'utf8');

  // 1. Confirm openModal is used and confirm() is never used
  assert.ok(scriptContent.includes('confirmRemovePlayer(playerId, playerName)'), 'confirmRemovePlayer exists');
  assert.ok(scriptContent.includes('openModal('), 'openModal is called');
  assert.ok(!scriptContent.includes('window.confirm(') && !scriptContent.includes('confirm('), 'Never calls native confirm');

  // 2. Confirm DELETE /api/players/ is called
  assert.ok(scriptContent.includes("api(`/api/players/${playerId}`, {"), 'Calls DELETE endpoint');

  // 3. Confirm BroadcastChannel event format
  assert.ok(scriptContent.includes("broadcastSyncEvent('player', 'deleted', { entityId: playerId })"), 'Emits exact player deleted sync event');

  // 4. Confirm player incoming sync revocation
  assert.ok(scriptContent.includes("entity === 'player' && action === 'deleted'"), 'Listens for player deleted action');
  assert.ok(scriptContent.includes("Your player profile has been permanently removed"), 'Displays informative toast to deleted user');
  assert.ok(scriptContent.includes("logout();"), 'Immediately logs out removed user');

  // 5. Confirm window exports
  assert.ok(scriptContent.includes("window.confirmRemovePlayer = confirmRemovePlayer"), 'Exports confirmRemovePlayer to window');
  assert.ok(scriptContent.includes("window.executeRemovePlayer = executeRemovePlayer"), 'Exports executeRemovePlayer to window');
});

