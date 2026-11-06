// client/test/cross-token.parity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

const User = require('../src/lib/models/User');
const expressApp = require('../../src/app');

let expressServer: http.Server;
let expressPort: number;
let expressUrl: string;

let nextProcess: any;
const nextPort = 3000;
const nextUrl = `http://localhost:${nextPort}`;

async function waitForServer(url: string, retries = 30): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

test.before(async () => {
  // Connect both root Mongoose (used by Express) and client Mongoose to parityUri
  const rootMongoose = require(path.resolve(__dirname, '../../node_modules/mongoose'));
  if (rootMongoose.connection.readyState === 0) {
    await rootMongoose.connect(parityUri);
  }
  const clientMongoose = require('../node_modules/mongoose');
  if (clientMongoose.connection.readyState === 0) {
    await clientMongoose.connect(parityUri);
  }

  // 1. Start Express on random port
  await new Promise<void>((resolve) => {
    expressServer = expressApp.listen(0, () => {
      expressPort = (expressServer.address() as any).port;
      expressUrl = `http://localhost:${expressPort}`;
      resolve();
    });
  });
  console.log(`Express test server running on ${expressUrl}`);

  // 2. Start Next.js on port 3000 if not already running
  const isUp = await waitForServer(nextUrl, 2);
  if (!isUp) {
    const nextBin = path.resolve(__dirname, '../node_modules/next/dist/bin/next');
    nextProcess = spawn(
      process.execPath,
      ['-r', path.resolve(__dirname, '../../scripts/dns-preload.js'), nextBin, 'start', path.resolve(__dirname, '..'), '-p', String(nextPort)],
      {
        env: {
          ...process.env,
          MONGODB_URI: parityUri,
          JWT_SECRET: JWT_SECRET,
          PORT: String(nextPort)
        },
        stdio: 'ignore'
      }
    );
    const ready = await waitForServer(nextUrl, 30);
    assert.ok(ready, 'Next.js server must be up');
  }
  console.log(`Next.js test server running on ${nextUrl}`);
});

test.after(async () => {
  if (expressServer) {
    expressServer.close();
  }
  if (nextProcess) {
    nextProcess.kill();
  }
  try {
    const rootMongoose = require(path.resolve(__dirname, '../../node_modules/mongoose'));
    await rootMongoose.disconnect();
  } catch (_) {}
  try {
    const clientMongoose = require('../node_modules/mongoose');
    await clientMongoose.disconnect();
  } catch (_) {}
});

test('Cross-Token Parity: Express and Next.js issue interchangeable JWTs with identical structure', async () => {
  // Create user fixture in DB
  const testUsername = `crosstoken_${Date.now()}`;
  const testPassword = 'Password123!';
  const user = await User.create({
    name: 'Cross Token User',
    username: testUsername,
    email: `${testUsername}@example.com`,
    password: testPassword,
    role: 'coach'
  });

  try {
    // 1. Login via Express
    const expressLoginRes = await fetch(`${expressUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUsername, password: testPassword })
    });
    assert.equal(expressLoginRes.status, 200, 'Express login must succeed');
    const expressLoginData = await expressLoginRes.json();
    const expressToken = expressLoginData.token;
    assert.ok(expressToken, 'Express must return a token');

    // Decode Express token header & payload
    const expressDecoded: any = jwt.decode(expressToken, { complete: true });
    console.log('Express JWT Header:', expressDecoded.header);
    console.log('Express JWT Payload:', expressDecoded.payload);
    assert.equal(expressDecoded.header.alg, 'HS256', 'Express algorithm must be HS256');
    assert.equal(expressDecoded.payload.id, user._id.toString());
    assert.equal(expressDecoded.payload.role, 'coach');
    assert.equal(expressDecoded.payload.username, testUsername);
    assert.equal(expressDecoded.payload.email, `${testUsername}@example.com`);
    assert.equal(expressDecoded.payload.mustChangePassword, false);
    // Expiry ~ 8h (28800s)
    const expressTtl = expressDecoded.payload.exp - expressDecoded.payload.iat;
    assert.equal(expressTtl, 8 * 3600, 'Express token TTL must be exactly 8 hours');

    // 2. Consume Express token on Next.js /api/auth/me
    const nextMeRes = await fetch(`${nextUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expressToken}` }
    });
    assert.equal(nextMeRes.status, 200, 'Next.js must accept Express token');
    const nextMeData = await nextMeRes.json();
    assert.equal(nextMeData._id.toString(), user._id.toString(), 'Next.js /me must return identical user ID');
    assert.equal(nextMeData.username, testUsername);
    console.log('✓ Express token verified successfully on Next.js /api/auth/me');

    // 3. Login via Next.js
    const nextLoginRes = await fetch(`${nextUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUsername, password: testPassword })
    });
    assert.equal(nextLoginRes.status, 200, 'Next.js login must succeed');
    const nextLoginData = await nextLoginRes.json();
    const nextToken = nextLoginData.token;
    assert.ok(nextToken, 'Next.js must return a token');

    // Decode Next.js token header & payload
    const nextDecoded: any = jwt.decode(nextToken, { complete: true });
    console.log('Next.js JWT Header:', nextDecoded.header);
    console.log('Next.js JWT Payload:', nextDecoded.payload);
    assert.equal(nextDecoded.header.alg, 'HS256', 'Next.js algorithm must be HS256');
    assert.equal(nextDecoded.payload.id, user._id.toString());
    assert.equal(nextDecoded.payload.role, 'coach');
    assert.equal(nextDecoded.payload.username, testUsername);
    assert.equal(nextDecoded.payload.email, `${testUsername}@example.com`);
    assert.equal(nextDecoded.payload.mustChangePassword, false);
    const nextTtl = nextDecoded.payload.exp - nextDecoded.payload.iat;
    assert.equal(nextTtl, 8 * 3600, 'Next.js token TTL must be exactly 8 hours');

    // 4. Consume Next.js token on Express /api/auth/me
    const expressMeRes = await fetch(`${expressUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${nextToken}` }
    });
    assert.equal(expressMeRes.status, 200, 'Express must accept Next.js token');
    const expressMeData = await expressMeRes.json();
    assert.equal(expressMeData._id.toString(), user._id.toString(), 'Express /me must return identical user ID');
    assert.equal(expressMeData.username, testUsername);
    console.log('✓ Next.js token verified successfully on Express /api/auth/me');

  } finally {
    await User.findByIdAndDelete(user._id);
  }
});

test('Cross-Server Password Hashing: bcryptjs cost 10 hashes verify bidirectionally between Express and Next.js', async () => {
  const rootUser = require(path.resolve(__dirname, '../../src/models/User'));
  const testPassword = 'OriginalSecretPassword123!';
  const updatedPassword = 'NewSecretPassword456!';

  // 1. User created by Express model with bcryptjs cost 10
  const expressUser = await rootUser.create({
    name: 'Express Hashed User',
    username: `exphash_${Date.now()}`,
    email: `exphash_${Date.now()}@test.com`,
    password: testPassword,
    role: 'coach'
  });

  try {
    // 2. Next.js /api/auth/login verifies hash created by Express
    const nextLoginRes = await fetch(`${nextUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: expressUser.username, password: testPassword })
    });
    assert.equal(nextLoginRes.status, 200, 'Next.js must verify password hashed by Express');
    const nextLoginData = await nextLoginRes.json();
    console.log('✓ Password hashed by Express verified successfully by Next.js login');

    // 3. Update password via Next.js /api/auth/change-password
    const changePwRes = await fetch(`${nextUrl}/api/auth/change-password`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${nextLoginData.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: testPassword, newPassword: updatedPassword })
    });
    assert.equal(changePwRes.status, 200, 'Next.js change-password must succeed');
    console.log('✓ Password updated and re-hashed by Next.js');

    // 4. Express /api/auth/login verifies new hash created by Next.js
    const expressReLoginRes = await fetch(`${expressUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: expressUser.username, password: updatedPassword })
    });
    assert.equal(expressReLoginRes.status, 200, 'Express must verify password hashed by Next.js');
    console.log('✓ Password hashed by Next.js verified successfully by Express login');
  } finally {
    await rootUser.findByIdAndDelete(expressUser._id);
  }
});
