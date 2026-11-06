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
    process.env.NODE_ENV = 'production';
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
    process.env.NODE_ENV = oldEnv;
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

