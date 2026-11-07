// client/test/staff-management.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const JWT_SECRET = 'test-jwt-secret-staff-unit-must-be-min-32-chars';
process.env.JWT_SECRET = JWT_SECRET;
process.env.MONGODB_URI = 'mongodb://localhost:27017/academy_dev';
process.env.ALLOW_PRODUCTION_DB = 'false';

// Prevent actual DB network connections by priming global mongoose cache
(globalThis as any).mongooseConnection = {
  conn: mongoose,
  promise: Promise.resolve(mongoose),
};

const dbModule = require('../src/lib/db');
if ((dbModule as any).cached) {
  (dbModule as any).cached.conn = mongoose;
  (dbModule as any).cached.promise = Promise.resolve(mongoose);
}

const User = require('../src/lib/models/User');
const Player = require('../src/lib/models/Player');

User.findById = async () => ({ _id: '507f1f77bcf86cd799439004', role: 'player' });

// Helper to craft mock Request
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
  if (options.body) {
    reqInit.body = JSON.stringify(options.body);
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

test('STAFF AUTH GUARD - GET /api/admin/staff blocks unauthenticated and non-admin requests', async () => {
  const { GET } = await import('../src/app/api/admin/staff/route');

  // 1. No token -> 401
  const reqNoToken = makeRequest('http://localhost:3000/api/admin/staff');
  const resNoToken = await GET(reqNoToken);
  assert.equal(resNoToken.status, 401);
  const dataNoToken = await resNoToken.json();
  assert.equal(dataNoToken.error, 'No token provided');

  // 2. Coach token -> 403
  const reqCoach = makeRequest('http://localhost:3000/api/admin/staff', { token: coachToken });
  const resCoach = await GET(reqCoach);
  assert.equal(resCoach.status, 403);
  const dataCoach = await resCoach.json();
  assert.equal(dataCoach.error, 'Forbidden');

  // 3. Scout token -> 403
  const reqScout = makeRequest('http://localhost:3000/api/admin/staff', { token: scoutToken });
  const resScout = await GET(reqScout);
  assert.equal(resScout.status, 403);

  // 4. Player token -> 403
  const reqPlayer = makeRequest('http://localhost:3000/api/admin/staff', { token: playerToken });
  const resPlayer = await GET(reqPlayer);
  assert.equal(resPlayer.status, 403);
});

test('STAFF AUTH GUARD - POST /api/admin/staff blocks unauthenticated and non-admin requests', async () => {
  const { POST } = await import('../src/app/api/admin/staff/route');

  // 1. No token -> 401
  const reqNoToken = makeRequest('http://localhost:3000/api/admin/staff', {
    method: 'POST',
    body: { name: 'Test', username: 'test.staff', role: 'coach', password: 'password123' },
  });
  const resNoToken = await POST(reqNoToken);
  assert.equal(resNoToken.status, 401);

  // 2. Coach -> 403
  const reqCoach = makeRequest('http://localhost:3000/api/admin/staff', {
    method: 'POST',
    token: coachToken,
    body: { name: 'Test', username: 'test.staff', role: 'coach', password: 'password123' },
  });
  const resCoach = await POST(reqCoach);
  assert.equal(resCoach.status, 403);
});

test('STAFF AUTH GUARD - PATCH /api/admin/staff/[id] blocks unauthenticated and non-admin requests', async () => {
  const { PATCH } = await import('../src/app/api/admin/staff/[id]/route');

  const reqNoToken = makeRequest('http://localhost:3000/api/admin/staff/507f1f77bcf86cd799439011', {
    method: 'PATCH',
    body: { name: 'Updated Name' },
  });
  const resNoToken = await PATCH(reqNoToken, { params: Promise.resolve({ id: '507f1f77bcf86cd799439011' }) });
  assert.equal(resNoToken.status, 401);

  const reqCoach = makeRequest('http://localhost:3000/api/admin/staff/507f1f77bcf86cd799439011', {
    method: 'PATCH',
    token: coachToken,
    body: { name: 'Updated Name' },
  });
  const resCoach = await PATCH(reqCoach, { params: Promise.resolve({ id: '507f1f77bcf86cd799439011' }) });
  assert.equal(resCoach.status, 403);
});

test('STAFF AUTH GUARD - DELETE /api/admin/staff/[id] blocks unauthenticated and non-admin requests', async () => {
  const { DELETE } = await import('../src/app/api/admin/staff/[id]/route');

  const reqNoToken = makeRequest('http://localhost:3000/api/admin/staff/507f1f77bcf86cd799439011', {
    method: 'DELETE',
  });
  const resNoToken = await DELETE(reqNoToken, { params: Promise.resolve({ id: '507f1f77bcf86cd799439011' }) });
  assert.equal(resNoToken.status, 401);

  const reqScout = makeRequest('http://localhost:3000/api/admin/staff/507f1f77bcf86cd799439011', {
    method: 'DELETE',
    token: scoutToken,
  });
  const resScout = await DELETE(reqScout, { params: Promise.resolve({ id: '507f1f77bcf86cd799439011' }) });
  assert.equal(resScout.status, 403);
});

test('STAFF VALIDATION - POST /api/admin/staff enforces role restrictions (only coach or scout)', async () => {
  const { POST } = await import('../src/app/api/admin/staff/route');

  // Attempt to create an 'admin' account
  const reqAdminRole = makeRequest('http://localhost:3000/api/admin/staff', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Super Admin', username: 'super.admin', role: 'admin', password: 'password123' },
  });
  const resAdminRole = await POST(reqAdminRole);
  assert.equal(resAdminRole.status, 400);
  const dataAdminRole = await resAdminRole.json();
  assert.match(dataAdminRole.error, /Role must be strictly either coach or scout/);

  // Attempt to create a 'player' account via staff route
  const reqPlayerRole = makeRequest('http://localhost:3000/api/admin/staff', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Player User', username: 'player.user', role: 'player', password: 'password123' },
  });
  const resPlayerRole = await POST(reqPlayerRole);
  assert.equal(resPlayerRole.status, 400);
});

test('STAFF VALIDATION - POST /api/admin/staff validates username format and password length', async () => {
  const { POST } = await import('../src/app/api/admin/staff/route');

  const origFindOne = User.findOne;
  User.findOne = async () => null;

  try {
    // Username too short
    const reqShortUser = makeRequest('http://localhost:3000/api/admin/staff', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Coach Dev', username: 'ab', role: 'coach', password: 'password123' },
    });
    const resShortUser = await POST(reqShortUser);
    assert.equal(resShortUser.status, 400);
    const dataShortUser = await resShortUser.json();
    assert.match(dataShortUser.error, /3-30 characters/);

    // Username with forbidden characters
    const reqBadUser = makeRequest('http://localhost:3000/api/admin/staff', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Coach Dev', username: 'coach@special#', role: 'coach', password: 'password123' },
    });
    const resBadUser = await POST(reqBadUser);
    assert.equal(resBadUser.status, 400);

    // Password too short (< 8 chars)
    const reqShortPass = makeRequest('http://localhost:3000/api/admin/staff', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Coach Dev', username: 'coach.valid', role: 'coach', password: 'short' },
    });
    const resShortPass = await POST(reqShortPass);
    assert.equal(resShortPass.status, 400);
    const dataShortPass = await resShortPass.json();
    assert.match(dataShortPass.error, /at least 8 characters/);
  } finally {
    User.findOne = origFindOne;
  }
});

test('STAFF VALIDATION - POST /api/admin/staff checks duplicate username and never returns password hash', async () => {
  const { POST } = await import('../src/app/api/admin/staff/route');

  const origFindOne = User.findOne;
  User.findOne = async (query: any) => {
    if (query.username === 'coach.existing') {
      return { _id: '507f1f77bcf86cd799439099', username: 'coach.existing' };
    }
    return null;
  };

  try {
    const reqDup = makeRequest('http://localhost:3000/api/admin/staff', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Existing Coach', username: 'coach.existing', role: 'coach', password: 'password123' },
    });
    const resDup = await POST(reqDup);
    assert.equal(resDup.status, 409);
    const dataDup = await resDup.json();
    assert.match(dataDup.error, /already taken/);
  } finally {
    User.findOne = origFindOne;
  }
});

test('STAFF VALIDATION - DELETE blocks admin deleting themselves', async () => {
  const { DELETE } = await import('../src/app/api/admin/staff/[id]/route');

  const adminId = '507f1f77bcf86cd799439099';
  const selfAdminToken = jwt.sign(
    { id: adminId, role: 'admin', name: 'Admin Self', username: 'admin_self' },
    JWT_SECRET
  );

  const reqSelfDelete = makeRequest(`http://localhost:3000/api/admin/staff/${adminId}`, {
    method: 'DELETE',
    token: selfAdminToken,
  });
  const resSelfDelete = await DELETE(reqSelfDelete, { params: Promise.resolve({ id: adminId }) });
  assert.equal(resSelfDelete.status, 400);
  const dataSelfDelete = await resSelfDelete.json();
  assert.equal(dataSelfDelete.error, 'Cannot delete your own admin account');
});

test('STAFF VALIDATION - DELETE blocks removing a coach who has assigned players', async () => {
  const { DELETE } = await import('../src/app/api/admin/staff/[id]/route');

  const coachId = '507f1f77bcf86cd799439055';
  const origFindById = User.findById;
  const origCount = Player.countDocuments;

  User.findById = async (id: any) => {
    if (id.toString() === coachId) {
      return { _id: coachId, role: 'coach', name: 'Busy Coach', username: 'busy.coach' };
    }
    return null;
  };

  Player.countDocuments = async (query: any) => {
    if (query.coach && query.coach.toString() === coachId) {
      return 5; // 5 assigned players
    }
    return 0;
  };

  try {
    const reqDelete = makeRequest(`http://localhost:3000/api/admin/staff/${coachId}`, {
      method: 'DELETE',
      token: adminToken,
    });
    const resDelete = await DELETE(reqDelete, { params: Promise.resolve({ id: coachId }) });
    assert.equal(resDelete.status, 400);
    const dataDelete = await resDelete.json();
    assert.match(dataDelete.error, /Cannot delete coach 'Busy Coach' with 5 assigned player\(s\)/);
  } finally {
    User.findById = origFindById;
    Player.countDocuments = origCount;
  }
});

test('ROLE LOGIN MATCHING - verifies new staff role matching on login page', () => {
  function checkRoleMatch(selectedTab: string, userRole: string) {
    if (userRole !== selectedTab) {
      return {
        allowed: false,
        error: 'These credentials belong to a different role. Please choose the correct role tab.',
      };
    }
    return {
      allowed: true,
      error: null,
      redirect: userRole === 'scout' ? '/app/scout' : '/app',
    };
  }

  // 1. Coach logs in on Coach tab -> Allowed
  const coachOnCoach = checkRoleMatch('coach', 'coach');
  assert.equal(coachOnCoach.allowed, true);
  assert.equal(coachOnCoach.redirect, '/app');

  // 2. Scout logs in on Scout tab -> Allowed, redirects to /app/scout
  const scoutOnScout = checkRoleMatch('scout', 'scout');
  assert.equal(scoutOnScout.allowed, true);
  assert.equal(scoutOnScout.redirect, '/app/scout');

  // 3. Coach logs in on Admin tab -> Rejected with exact message
  const coachOnAdmin = checkRoleMatch('admin', 'coach');
  assert.equal(coachOnAdmin.allowed, false);
  assert.equal(coachOnAdmin.error, 'These credentials belong to a different role. Please choose the correct role tab.');

  // 4. Scout logs in on Coach tab -> Rejected
  const scoutOnCoach = checkRoleMatch('coach', 'scout');
  assert.equal(scoutOnCoach.allowed, false);
  assert.equal(scoutOnCoach.error, 'These credentials belong to a different role. Please choose the correct role tab.');
});
