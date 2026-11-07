// client/test/admin-player-audit.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const JWT_SECRET = 'test-jwt-secret-admin-player-audit-unit';
process.env.JWT_SECRET = JWT_SECRET;
process.env.MONGODB_URI = 'mongodb://localhost:27017/academy_dev';
process.env.ALLOW_PRODUCTION_DB = 'false';
process.env.NODE_ENV = 'test';
process.env.SIMULATE_NO_TX = 'true';

// Prime the global mongoose connection cache to avoid network connections
(globalThis as any).mongooseConnection = {
  conn: mongoose,
  promise: Promise.resolve(mongoose),
};

// Also prime the imported db cache directly
const dbModule = require('../src/lib/db');
if ((dbModule as any).cached) {
  (dbModule as any).cached.conn = mongoose;
  (dbModule as any).cached.promise = Promise.resolve(mongoose);
}

const { SyncState } = require('../src/lib/sync');
SyncState.findById = async () => ({ version: 1 });
SyncState.findOneAndUpdate = async () => ({ version: 2 });

const User = require('../src/lib/models/User');
const Player = require('../src/lib/models/Player');
const Session = require('../src/lib/models/Session');
const Match = require('../src/lib/models/Match');
const MatchParticipation = require('../src/lib/models/MatchParticipation');
const AuditLog = require('../src/lib/models/AuditLog');

function makeRequest(
  url: string,
  options: {
    method?: string;
    token?: string;
    body?: any;
  } = {}
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const reqInit: RequestInit = {
    method: options.method || 'GET',
    headers,
  };
  if (options.body !== undefined) {
    reqInit.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  return new Request(url, reqInit);
}

const adminToken = jwt.sign(
  { id: '507f1f77bcf86cd799439001', role: 'admin', name: 'Admin User', username: 'admin' },
  JWT_SECRET
);
const coachToken = jwt.sign(
  { id: '507f1f77bcf86cd799439002', role: 'coach', name: 'Coach Sharma', username: 'coach' },
  JWT_SECRET
);
const scoutToken = jwt.sign(
  { id: '507f1f77bcf86cd799439003', role: 'scout', name: 'Scout Verma', username: 'scout' },
  JWT_SECRET
);
const playerToken = jwt.sign(
  { id: '507f1f77bcf86cd799439004', role: 'player', name: 'Kamran Akmal', username: 'md260001' },
  JWT_SECRET
);

// Global default mocks for auth token verification
User.findById = async (id: any) => ({
  _id: id,
  name: 'Mock User',
  username: 'mockuser',
  role: 'player',
  mustChangePassword: false,
});
Player.findById = async (id: any) => ({
  _id: id,
  name: 'Mock Player',
  username: 'mockplayer',
  sport: 'Football',
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTH GUARDS: 401 Unauthenticated & 403 Non-Admin on All 7 Routes
// ─────────────────────────────────────────────────────────────────────────────

test('AUTH GUARD - GET /api/admin/players blocks unauthenticated and non-admin requests', async () => {
  const { GET } = await import('../src/app/api/admin/players/route');

  const resNoToken = await GET(makeRequest('http://localhost:3000/api/admin/players'));
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await GET(makeRequest('http://localhost:3000/api/admin/players', { token }));
    assert.equal(resForbidden.status, 403);
  }
});

test('AUTH GUARD - PATCH /api/admin/players/[id] blocks unauthenticated and non-admin requests', async () => {
  const { PATCH } = await import('../src/app/api/admin/players/[id]/route');
  const validId = '507f1f77bcf86cd799439011';

  const resNoToken = await PATCH(
    makeRequest(`http://localhost:3000/api/admin/players/${validId}`, { method: 'PATCH', body: { name: 'Test' } }),
    { params: Promise.resolve({ id: validId }) }
  );
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await PATCH(
      makeRequest(`http://localhost:3000/api/admin/players/${validId}`, { method: 'PATCH', token, body: { name: 'Test' } }),
      { params: Promise.resolve({ id: validId }) }
    );
    assert.equal(resForbidden.status, 403);
  }
});

test('AUTH GUARD - DELETE /api/admin/players/[id] blocks unauthenticated and non-admin requests', async () => {
  const { DELETE } = await import('../src/app/api/admin/players/[id]/route');
  const validId = '507f1f77bcf86cd799439011';

  const resNoToken = await DELETE(
    makeRequest(`http://localhost:3000/api/admin/players/${validId}`, { method: 'DELETE', body: { confirm: true } }),
    { params: Promise.resolve({ id: validId }) }
  );
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await DELETE(
      makeRequest(`http://localhost:3000/api/admin/players/${validId}`, { method: 'DELETE', token, body: { confirm: true } }),
      { params: Promise.resolve({ id: validId }) }
    );
    assert.equal(resForbidden.status, 403);
  }
});

test('AUTH GUARD - POST /api/admin/players/[id]/reset-password blocks unauthenticated and non-admin requests', async () => {
  const { POST } = await import('../src/app/api/admin/players/[id]/reset-password/route');
  const validId = '507f1f77bcf86cd799439011';

  const resNoToken = await POST(
    makeRequest(`http://localhost:3000/api/admin/players/${validId}/reset-password`, { method: 'POST', body: {} }),
    { params: Promise.resolve({ id: validId }) }
  );
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await POST(
      makeRequest(`http://localhost:3000/api/admin/players/${validId}/reset-password`, { method: 'POST', token, body: {} }),
      { params: Promise.resolve({ id: validId }) }
    );
    assert.equal(resForbidden.status, 403);
  }
});

test('AUTH GUARD - POST /api/admin/players/reassign blocks unauthenticated and non-admin requests', async () => {
  const { POST } = await import('../src/app/api/admin/players/reassign/route');

  const resNoToken = await POST(
    makeRequest('http://localhost:3000/api/admin/players/reassign', {
      method: 'POST',
      body: { playerIds: ['507f1f77bcf86cd799439011'], coachId: '507f1f77bcf86cd799439002' },
    })
  );
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await POST(
      makeRequest('http://localhost:3000/api/admin/players/reassign', {
        method: 'POST',
        token,
        body: { playerIds: ['507f1f77bcf86cd799439011'], coachId: '507f1f77bcf86cd799439002' },
      })
    );
    assert.equal(resForbidden.status, 403);
  }
});

test('AUTH GUARD - GET /api/admin/audit blocks unauthenticated and non-admin requests', async () => {
  const { GET } = await import('../src/app/api/admin/audit/route');

  const resNoToken = await GET(makeRequest('http://localhost:3000/api/admin/audit'));
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await GET(makeRequest('http://localhost:3000/api/admin/audit', { token }));
    assert.equal(resForbidden.status, 403);
  }
});

test('AUTH GUARD - GET /api/admin/export/players?format=csv blocks unauthenticated and non-admin requests', async () => {
  const { GET } = await import('../src/app/api/admin/export/players/route');

  const resNoToken = await GET(makeRequest('http://localhost:3000/api/admin/export/players?format=csv'));
  assert.equal(resNoToken.status, 401);

  for (const token of [coachToken, scoutToken, playerToken]) {
    const resForbidden = await GET(makeRequest('http://localhost:3000/api/admin/export/players?format=csv', { token }));
    assert.equal(resForbidden.status, 403);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATA INTEGRITY & NO PASSWORD HASHES IN ANY RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

test('SECURITY & SHAPE - GET /api/admin/players never returns password or password hashes', async () => {
  const { GET } = await import('../src/app/api/admin/players/route');

  const mockPlayerId = new mongoose.Types.ObjectId();
  const mockCoachId = new mongoose.Types.ObjectId();

  const origFindPlayer = Player.find;
  const origFindUser = User.find;
  const origFindSession = Session.find;
  const origFindMatch = Match.find;
  const origCountMatch = Match.countDocuments;
  const origFindPart = MatchParticipation.find;

  Player.find = () => ({
    populate: () => ({
      sort: () => ({
        lean: async () => [
          {
            _id: mockPlayerId,
            name: 'Rohit Sharma',
            playerId: 'md260010',
            username: 'md260010',
            age: 24,
            sport: 'Cricket',
            coach: { _id: mockCoachId, name: 'Coach Rahul', username: 'coach.rahul' },
            defaultParticipation: 'both',
            createdAt: new Date(),
          },
        ],
      }),
    }),
  });

  User.find = () => ({
    select: () => ({
      lean: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          playerId: mockPlayerId,
          username: 'md260010',
          password: 'THIS_SHOULD_NEVER_BE_RETURNED',
        },
      ],
    }),
  });

  Session.find = () => ({ lean: async () => [] });
  Match.find = () => ({ lean: async () => [] });
  Match.countDocuments = async () => 0;
  MatchParticipation.find = () => ({ populate: () => ({ lean: async () => [] }) });

  try {
    const res = await GET(makeRequest('http://localhost:3000/api/admin/players', { token: adminToken }));
    assert.equal(res.status, 200);

    const players = await res.json();
    assert.equal(Array.isArray(players), true);
    assert.equal(players.length, 1);

    const player = players[0];
    assert.equal(player.name, 'Rohit Sharma');
    assert.equal(player.username, 'md260010');
    assert.equal(player.sport, 'Cricket');
    assert.equal(player.age, 24);
    assert.equal(typeof player.attendanceRate, 'number');
    assert.equal(typeof player.matchesPlayed, 'number');
    assert.equal(typeof player.isReady, 'boolean');

    // Strict security check: neither 'password' nor any hash exists anywhere
    const jsonStr = JSON.stringify(players);
    assert.equal(jsonStr.includes('password'), false);
    assert.equal(jsonStr.includes('THIS_SHOULD_NEVER_BE_RETURNED'), false);
    assert.equal(player.password, undefined);
  } finally {
    Player.find = origFindPlayer;
    User.find = origFindUser;
    Session.find = origFindSession;
    Match.find = origFindMatch;
    Match.countDocuments = origCountMatch;
    MatchParticipation.find = origFindPart;
  }
});

test('EXPORT CSV - GET /api/admin/export/players returns CSV with headers and data', async () => {
  const { GET } = await import('../src/app/api/admin/export/players/route');

  const mockPlayerId = new mongoose.Types.ObjectId();
  const origFindPlayer = Player.find;
  const origFindUser = User.find;
  const origFindSession = Session.find;
  const origFindMatch = Match.find;
  const origCountMatch = Match.countDocuments;
  const origFindPart = MatchParticipation.find;

  Player.find = () => ({
    populate: () => ({
      sort: () => ({
        lean: async () => [
          {
            _id: mockPlayerId,
            name: 'Aadil Azhar',
            playerId: 'md260003',
            username: 'md260003',
            age: 22,
            sport: 'Football',
            coach: { name: 'Coach Sharma' },
            defaultParticipation: 'both',
            registeredOn: new Date('2026-01-15'),
          },
        ],
      }),
    }),
  });

  User.find = () => ({
    select: () => ({
      lean: async () => [{ playerId: mockPlayerId, username: 'md260003' }],
    }),
  });

  Session.find = () => ({ lean: async () => [] });
  Match.find = () => ({ lean: async () => [] });
  Match.countDocuments = async () => 0;
  MatchParticipation.find = () => ({ populate: () => ({ lean: async () => [] }) });

  try {
    const res = await GET(makeRequest('http://localhost:3000/api/admin/export/players?format=csv', { token: adminToken }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(res.headers.get('content-disposition') || '', /attachment; filename="players-export\.csv"/);

    const csvText = await res.text();
    assert.match(csvText, /"Player ID","Name","Username","Sport","Age","Coach"/);
    assert.match(csvText, /Aadil Azhar/);
    assert.match(csvText, /md260003/);
    assert.match(csvText, /Football/);
    assert.equal(csvText.includes('password'), false);
  } finally {
    Player.find = origFindPlayer;
    User.find = origFindUser;
    Session.find = origFindSession;
    Match.find = origFindMatch;
    Match.countDocuments = origCountMatch;
    MatchParticipation.find = origFindPart;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EDITING PLAYER PERSISTENCE & AUDIT LOGGING
// ─────────────────────────────────────────────────────────────────────────────

test('PLAYER EDIT - PATCH persists updates, validates input, syncs user name, and logs audit', async () => {
  const { PATCH } = await import('../src/app/api/admin/players/[id]/route');

  const playerId = new mongoose.Types.ObjectId();
  const coachId = new mongoose.Types.ObjectId();

  let savedPlayer: any = {
    _id: playerId,
    name: 'Old Name',
    age: 18,
    sport: 'Cricket',
    coach: coachId,
    defaultParticipation: 'both',
    save: async function () { return this; },
  };

  let auditEntries: any[] = [];
  const origFindPlayerById = Player.findById;
  const origFindCoach = User.findOne;
  const origUpdateUsers = User.updateMany;
  const origAuditSave = AuditLog.prototype.save;

  Player.findById = (id: any) => ({
    populate: () => ({
      lean: async () => ({
        ...savedPlayer,
        coach: { _id: coachId, name: 'Coach Sharma' },
      }),
    }),
    then: (resolve: any) => resolve(savedPlayer),
  });

  User.findOne = async (query: any) => {
    if (query.role === 'coach') return { _id: coachId, name: 'Coach Sharma' };
    return null;
  };

  let updatedUserName = '';
  User.updateMany = async (filter: any, update: any) => {
    if (update.$set?.name) updatedUserName = update.$set.name;
    return { modifiedCount: 1 };
  };

  AuditLog.prototype.save = async function () {
    auditEntries.push(this.toObject ? this.toObject() : this);
    return this;
  };

  try {
    // 1. Invalid age (too low) -> 400
    const resBadAge = await PATCH(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}`, {
        method: 'PATCH',
        token: adminToken,
        body: { age: 2 },
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resBadAge.status, 400);

    // 2. Invalid sport -> 400
    const resBadSport = await PATCH(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}`, {
        method: 'PATCH',
        token: adminToken,
        body: { sport: 'WaterPolo' },
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resBadSport.status, 400);

    // 3. Valid update
    const resValid = await PATCH(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}`, {
        method: 'PATCH',
        token: adminToken,
        body: { name: 'Rohith Updated', age: 21, sport: 'Football', defaultParticipation: 'match' },
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resValid.status, 200);

    assert.equal(savedPlayer.name, 'Rohith Updated');
    assert.equal(savedPlayer.age, 21);
    assert.equal(savedPlayer.sport, 'Football');
    assert.equal(savedPlayer.defaultParticipation, 'match');
    assert.equal(updatedUserName, 'Rohith Updated');

    // Verify audit log entry
    const playerEditLog = auditEntries.find((a) => a.action === 'player:edit');
    assert.notEqual(playerEditLog, undefined);
    assert.equal(playerEditLog.targetType, 'Player');
    assert.equal(playerEditLog.targetName, 'Rohith Updated');
  } finally {
    Player.findById = origFindPlayerById;
    User.findOne = origFindCoach;
    User.updateMany = origUpdateUsers;
    AuditLog.prototype.save = origAuditSave;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. RESET PASSWORD & ONE-TIME CREDENTIAL ISSUANCE
// ─────────────────────────────────────────────────────────────────────────────

test('PLAYER RESET PASSWORD - Sets mustChangePassword, returns password once, and never logs password', async () => {
  const { POST } = await import('../src/app/api/admin/players/[id]/reset-password/route');

  const playerId = new mongoose.Types.ObjectId();
  const mockPlayer = {
    _id: playerId,
    name: 'Kamran Akmal',
    username: 'md260001',
    playerId: 'md260001',
  };

  let mockUser: any = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Kamran Akmal',
    username: 'md260001',
    playerId: playerId,
    password: 'old_hashed_password',
    mustChangePassword: false,
    save: async function () { return this; },
  };

  let auditEntries: any[] = [];
  const origFindPlayer = Player.findById;
  const origFindUser = User.findOne;
  const origAuditSave = AuditLog.prototype.save;

  Player.findById = async () => mockPlayer;
  User.findOne = async () => mockUser;
  AuditLog.prototype.save = async function () {
    auditEntries.push(this.toObject ? this.toObject() : this);
    return this;
  };

  try {
    // Custom password < 8 chars -> 400
    const resShort = await POST(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}/reset-password`, {
        method: 'POST',
        token: adminToken,
        body: { password: 'short' },
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resShort.status, 400);

    // Auto-generate password
    const resGen = await POST(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}/reset-password`, {
        method: 'POST',
        token: adminToken,
        body: {},
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resGen.status, 200);

    const data = await resGen.json();
    assert.equal(typeof data.password, 'string');
    assert.equal(data.password.length >= 8, true);
    assert.equal(data.username, 'md260001');
    assert.equal(data.mustChangePassword, true);
    assert.equal(mockUser.mustChangePassword, true);

    // Verify audit log DOES NOT contain the password!
    const resetLog = auditEntries.find((a) => a.action === 'player:reset_password');
    assert.notEqual(resetLog, undefined);
    const logDetailsStr = JSON.stringify(resetLog.details || {});
    assert.equal(logDetailsStr.includes(data.password), false);
    assert.equal(logDetailsStr.includes('password'), false);
  } finally {
    Player.findById = origFindPlayer;
    User.findOne = origFindUser;
    AuditLog.prototype.save = origAuditSave;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REASSIGN COACH
// ─────────────────────────────────────────────────────────────────────────────

test('REASSIGN PLAYERS - Updates coach reference and writes audit entry', async () => {
  const { POST } = await import('../src/app/api/admin/players/reassign/route');

  const p1 = new mongoose.Types.ObjectId();
  const p2 = new mongoose.Types.ObjectId();
  const coachId = new mongoose.Types.ObjectId();

  let updatedFilter: any = null;
  let updatedSet: any = null;
  let auditEntries: any[] = [];

  const origFindUser = User.findOne;
  const origUpdateMany = Player.updateMany;
  const origAuditSave = AuditLog.prototype.save;

  User.findOne = async (query: any) => {
    if (query.role === 'coach') {
      return { _id: coachId, name: 'Coach Dev', username: 'coach.dev' };
    }
    return null;
  };

  Player.updateMany = async (filter: any, update: any) => {
    updatedFilter = filter;
    updatedSet = update;
    return { modifiedCount: 2 };
  };

  AuditLog.prototype.save = async function () {
    auditEntries.push(this.toObject ? this.toObject() : this);
    return this;
  };

  try {
    const res = await POST(
      makeRequest('http://localhost:3000/api/admin/players/reassign', {
        method: 'POST',
        token: adminToken,
        body: { playerIds: [p1.toString(), p2.toString()], coachId: coachId.toString() },
      })
    );
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.reassignedCount, 2);
    assert.equal(updatedSet.$set.coach.toString(), coachId.toString());

    // Verify audit log
    const reassignLog = auditEntries.find((a) => a.action === 'player:reassign');
    assert.notEqual(reassignLog, undefined);
    assert.equal(reassignLog.details.reassignedCount, 2);
    assert.equal(reassignLog.details.newCoachName, 'Coach Dev');
  } finally {
    User.findOne = origFindUser;
    Player.updateMany = origUpdateMany;
    AuditLog.prototype.save = origAuditSave;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CASCADE DELETION & LOGIN REJECTION
// ─────────────────────────────────────────────────────────────────────────────

test('CASCADE DELETION - Requires confirm: true, deletes user account & cascades, and stops deleted user login', async () => {
  const { DELETE } = await import('../src/app/api/admin/players/[id]/route');
  const { POST: loginRoute } = await import('../src/app/api/auth/login/route');

  const playerId = new mongoose.Types.ObjectId();
  const playerDoc = {
    _id: playerId,
    name: 'Temporary Player',
    username: 'md260099',
    playerId: 'md260099',
    sport: 'Football',
  };

  let deletedUsersFilter: any = null;
  let deletedPlayerId: any = null;
  let auditEntries: any[] = [];

  const origFindPlayerById = Player.findById;
  const origFindPlayerByIdAndDelete = Player.findByIdAndDelete;
  const origDeleteManyUsers = User.deleteMany;
  const origUpdateManySessions = Session.updateMany;
  const origUpdateManyMatches = Match.updateMany;
  const origDeleteManyMatchParts = MatchParticipation.deleteMany;
  const origUpdateManyMatchParts = MatchParticipation.updateMany;
  const origAuditSave = AuditLog.prototype.save;
  const origFindOneUser = User.findOne;

  Player.findById = async () => playerDoc;
  Player.findByIdAndDelete = async (id: any) => { deletedPlayerId = id; return playerDoc; };
  User.deleteMany = async (filter: any) => { deletedUsersFilter = filter; return { deletedCount: 1 }; };
  Session.updateMany = async () => ({ modifiedCount: 1 });
  Match.updateMany = async () => ({ modifiedCount: 1 });
  MatchParticipation.deleteMany = async () => ({ deletedCount: 0 });
  MatchParticipation.updateMany = async () => ({ modifiedCount: 0 });

  AuditLog.prototype.save = async function () {
    auditEntries.push(this.toObject ? this.toObject() : this);
    return this;
  };

  try {
    // 1. Missing confirm: true -> 400
    const resNoConfirm = await DELETE(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}`, {
        method: 'DELETE',
        token: adminToken,
        body: {},
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resNoConfirm.status, 400);

    // 2. With confirm: true -> 200
    const resConfirm = await DELETE(
      makeRequest(`http://localhost:3000/api/admin/players/${playerId}`, {
        method: 'DELETE',
        token: adminToken,
        body: { confirm: true },
      }),
      { params: Promise.resolve({ id: playerId.toString() }) }
    );
    assert.equal(resConfirm.status, 200);

    // Verified cascade operations executed
    assert.notEqual(deletedUsersFilter, null);
    assert.equal(deletedPlayerId.toString(), playerId.toString());

    // Verified audit log created
    const deleteLog = auditEntries.find((a) => a.action === 'player:delete');
    assert.notEqual(deleteLog, undefined);
    assert.equal(deleteLog.targetName, 'Temporary Player');

    // 3. Verify that deleted user can NO LONGER log in (returns 401 invalid credentials)
    User.findOne = async () => null; // User was deleted

    const loginRes = await loginRoute(
      makeRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: { identifier: 'md260099', password: 'player123' },
      })
    );
    assert.equal(loginRes.status, 401);
    const loginData = await loginRes.json();
    assert.match(loginData.error, /Invalid credentials/i);
  } finally {
    Player.findById = origFindPlayerById;
    Player.findByIdAndDelete = origFindPlayerByIdAndDelete;
    User.deleteMany = origDeleteManyUsers;
    Session.updateMany = origUpdateManySessions;
    Match.updateMany = origUpdateManyMatches;
    MatchParticipation.deleteMany = origDeleteManyMatchParts;
    MatchParticipation.updateMany = origUpdateManyMatchParts;
    AuditLog.prototype.save = origAuditSave;
    User.findOne = origFindOneUser;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. AUDIT LOG RETRIEVAL & PAGINATION
// ─────────────────────────────────────────────────────────────────────────────

test('AUDIT RETRIEVAL - GET /api/admin/audit returns paginated logs with sanitized fields', async () => {
  const { GET } = await import('../src/app/api/admin/audit/route');

  const origFindAudit = AuditLog.find;
  const origCountAudit = AuditLog.countDocuments;

  const sampleLogs = [
    {
      _id: new mongoose.Types.ObjectId(),
      action: 'staff:create',
      actorId: new mongoose.Types.ObjectId(),
      actorName: 'Admin User',
      actorRole: 'admin',
      targetType: 'Staff',
      targetName: 'Coach Dev',
      details: { role: 'coach', username: 'coach.dev' },
      timestamp: new Date(),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      action: 'player:delete',
      actorId: new mongoose.Types.ObjectId(),
      actorName: 'Admin User',
      actorRole: 'admin',
      targetType: 'Player',
      targetName: 'Test Player',
      details: { sport: 'Football' },
      timestamp: new Date(),
    },
  ];

  AuditLog.find = () => ({
    sort: () => ({
      skip: () => ({
        limit: () => ({
          lean: async () => sampleLogs,
        }),
      }),
    }),
  });
  AuditLog.countDocuments = async () => 2;

  try {
    const res = await GET(makeRequest('http://localhost:3000/api/admin/audit?page=1&limit=20', { token: adminToken }));
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.total, 2);
    assert.equal(data.page, 1);
    assert.equal(data.logs.length, 2);
    assert.equal(data.logs[0].action, 'staff:create');
    assert.equal(data.logs[1].action, 'player:delete');
    assert.equal(JSON.stringify(data).includes('password'), false);
  } finally {
    AuditLog.find = origFindAudit;
    AuditLog.countDocuments = origCountAudit;
  }
});
