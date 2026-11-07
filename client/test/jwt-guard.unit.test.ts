// client/test/jwt-guard.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getJwtSecret, authenticateRequest } from '../src/lib/auth';
import { GET as healthHandler } from '../src/app/api/health/route';

test('JWT Guard: getJwtSecret throws clearly if JWT_SECRET is missing or empty', () => {
  const originalSecret = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(
      () => getJwtSecret(),
      /JWT authentication configuration error: JWT_SECRET environment variable is not defined/,
      'Should throw an explicit configuration error when JWT_SECRET is missing'
    );

    process.env.JWT_SECRET = '';
    assert.throws(
      () => getJwtSecret(),
      /JWT authentication configuration error: JWT_SECRET environment variable is not defined/,
      'Should throw an explicit configuration error when JWT_SECRET is empty string'
    );
  } finally {
    process.env.JWT_SECRET = originalSecret;
  }
});

test('JWT Guard: getJwtSecret returns the configured secret when defined', () => {
  const originalSecret = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'a_secure_production_jwt_secret_key_minimum_32_chars';
    assert.equal(getJwtSecret(), 'a_secure_production_jwt_secret_key_minimum_32_chars');
  } finally {
    process.env.JWT_SECRET = originalSecret;
  }
});

test('JWT Guard: authenticateRequest fails with 500 if JWT_SECRET is missing in environment', async () => {
  const originalSecret = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    const req = new Request('http://localhost:3000/api/players', {
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig',
      },
    });

    const result = await authenticateRequest(req);
    assert.ok(result.errorResponse, 'Must return error response when secret is unconfigured');
    assert.equal(result.errorResponse.status, 500);

    const body = await result.errorResponse.json();
    assert.equal(body.error, 'Server configuration error: JWT_SECRET is not configured');
  } finally {
    process.env.JWT_SECRET = originalSecret;
  }
});

test('/api/health: returns OK and leaks no secrets, URI or DB name', async () => {
  const res = await healthHandler();
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.deepEqual(data, { status: 'ok' });

  const rawJson = JSON.stringify(data);
  assert.ok(!rawJson.includes('mongodb'));
  assert.ok(!rawJson.includes('academy'));
  assert.ok(!rawJson.includes('secret'));
});

