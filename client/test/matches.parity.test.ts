// client/test/matches.parity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import path from 'path';
import { getEffectiveNow } from '../src/lib/clock';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

function authHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

test('MATCHES - Decision C: x-mock-now ignored when ALLOW_MOCK_NOW is not set and NODE_ENV is production', async () => {
  const fakeReq = new Request('http://localhost:3000/api/matches', {
    headers: { 'x-mock-now': '2030-01-01T00:00:00.000Z' },
  });

  const oldEnv = process.env.NODE_ENV;
  const oldFlag = process.env.ALLOW_MOCK_NOW;
  try {
    (process.env as any).NODE_ENV = 'production';
    delete process.env.ALLOW_MOCK_NOW;

    const effective = getEffectiveNow(fakeReq);
    const now = new Date();
    // Must be within 5 seconds of real wall-clock, NOT 2030
    assert.ok(
      Math.abs(effective.getTime() - now.getTime()) < 5000,
      'Effective now must be real wall clock when mock is disallowed'
    );
    assert.notEqual(effective.getUTCFullYear(), 2030);

    // Now test with test env or ALLOW_MOCK_NOW=true
    process.env.ALLOW_MOCK_NOW = 'true';
    const effectiveMocked = getEffectiveNow(fakeReq);
    assert.equal(effectiveMocked.getUTCFullYear(), 2030);
  } finally {
    (process.env as any).NODE_ENV = oldEnv;
    if (oldFlag) process.env.ALLOW_MOCK_NOW = oldFlag;
    else delete process.env.ALLOW_MOCK_NOW;
  }
});

test('MATCHES - Decision D: Static segments (check-eligibility, history, calendar) resolve before [id]', async () => {
  const coachToken = jwt.sign(
    { id: '65f000000000000000000001', role: 'coach', name: 'Test Coach' },
    JWT_SECRET
  );

  // 1. check-eligibility
  const eligRes = await fetch(
    `${baseUrl}/api/matches/check-eligibility?sport=Football&date=2026-11-01`,
    { headers: authHeader(coachToken) }
  );
  assert.equal(eligRes.status, 200);
  const eligData = await eligRes.json();
  assert.ok('minTeamSize' in eligData, 'check-eligibility must return eligibility payload');

  // 2. history
  const histRes = await fetch(`${baseUrl}/api/matches/history`, {
    headers: authHeader(coachToken),
  });
  assert.equal(histRes.status, 200);
  const histData = await histRes.json();
  assert.ok(Array.isArray(histData), 'history must return an array of matches');

  // 3. calendar
  const calRes = await fetch(`${baseUrl}/api/matches/calendar?month=2026-11`, {
    headers: authHeader(coachToken),
  });
  assert.equal(calRes.status, 200);
  const calData = await calRes.json();
  assert.ok(Array.isArray(calData), 'calendar must return an array of matches');
});

test('P1 REGRESSION - POST /api/matches with UI payload succeeds with 201', async () => {
  const mongoose = require('mongoose');
  const uri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  const User = require('../src/lib/models/User');
  const Player = require('../src/lib/models/Player');

  // Find or create a coach with >= 11 players
  let coach = await User.findOne({ role: 'coach', username: { $regex: /^coach_match_/ } });
  if (!coach) {
    coach = await User.findOne({ role: 'coach' });
  }

  // Ensure coach has 12 players for Football
  const count = await Player.countDocuments({ coach: coach._id, sport: { $regex: /^football$/i } });
  if (count < 11) {
    const toCreate = 11 - count;
    for (let i = 0; i < toCreate; i++) {
      await Player.create({
        name: `RosterAthlete_${Date.now()}_${i}`,
        age: 18,
        sport: 'Football',
        coach: coach._id,
        defaultParticipation: 'both',
      });
    }
  }

  const token = jwt.sign(
    { id: coach._id.toString(), role: 'coach', name: coach.name || 'Coach' },
    JWT_SECRET
  );

  const uiBody = {
    title: `Championship Final ${Date.now()}`,
    sport: 'Football',
    date: '2026-11-28',
    time: '17:00',
    opponent: `Titans FC ${Date.now()}`,
    venue: 'Main Stadium',
    description: 'Scheduled via Maidan Desk UI',
    selectedPlayerIds: null,
  };

  const res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(uiBody),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.title, uiBody.title);
  assert.equal(data.sport, 'Football');
  assert.equal(data.status, 'upcoming');
  assert.ok(data._id, 'Created match must have _id');
  await mongoose.disconnect();
});

