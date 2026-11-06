// scripts/test-next-parity.js
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert/strict');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const tz = process.env.TEST_TZ || 'UTC';
const port = process.env.PORT || '3000';
const baseUrl = `http://localhost:${port}`;

console.log(`Testing Next.js parity endpoints with TZ=${tz} against academy_parity on ${baseUrl}...`);

const nextBin = path.resolve(__dirname, '../client/node_modules/next/dist/bin/next');

const child = spawn(
  process.execPath,
  ['-r', path.resolve(__dirname, './dns-preload.js'), nextBin, 'start', path.resolve(__dirname, '../client'), '-p', port],
  {
    env: {
      ...process.env,
      MONGODB_URI: parityUri,
      TZ: tz,
      PORT: port
    },
    stdio: ['ignore', 'pipe', 'pipe']
  }
);

let childLogs = '';
child.stdout.on('data', d => { childLogs += d.toString(); });
child.stderr.on('data', d => { childLogs += d.toString(); });

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  const isUp = await waitForServer();
  if (!isUp) {
    console.error('Next.js failed to start within 15 seconds. Logs:\n', childLogs);
    child.kill();
    process.exit(1);
  }

  console.log(`✓ Next.js server is up on ${baseUrl}`);

  try {
    // 1. Check GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200, 'Health endpoint status must be 200');
    const healthData = await healthRes.json();
    assert.deepEqual(healthData, { status: 'ok' }, 'Health endpoint payload must be { status: "ok" }');
    console.log('✓ GET /api/health returned 200 { status: "ok" }');

    // 2. Check GET /api/sync/version
    const syncRes = await fetch(`${baseUrl}/api/sync/version`);
    assert.equal(syncRes.status, 200, 'Sync version endpoint status must be 200');
    const syncData = await syncRes.json();
    assert.equal(typeof syncData.version, 'number', 'version must be a number');
    assert.equal(syncData.clientsCount, 0, 'clientsCount must be 0');
    console.log(`✓ GET /api/sync/version returned 200`, syncData);

    console.log(`\nAll Phase 2 Next.js endpoints PASSED under TZ=${tz}!`);
  } catch (err) {
    console.error('Parity assertion error:', err);
    child.kill();
    process.exit(1);
  } finally {
    child.kill();
  }
}

run();

