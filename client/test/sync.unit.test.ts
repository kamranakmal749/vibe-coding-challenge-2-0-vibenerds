require('dns').setServers(['8.8.8.8', '1.1.1.1']);
// client/test/sync.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
process.env.MONGODB_URI = parityUri;

test('lib/sync.ts: getVersion and bumpSync initialize with Date.now() and increment afterwards', async () => {
  const { connectToDatabase } = await import('../src/lib/db');
  const { getVersion, bumpSync, SyncState } = await import('../src/lib/sync');

  await connectToDatabase();

  // 1. Clear existing global sync state
  await SyncState.deleteMany({ _id: 'global' });

  const startTime = Date.now();

  // 2. getVersion() on absent document initializes with Date.now()
  const v1Data = await getVersion();
  assert.equal(typeof v1Data.version, 'number');
  assert.equal(v1Data.clientsCount, 0);
  assert.ok(v1Data.version >= startTime - 100, 'Version should be initialized to Date.now()');
  assert.ok(v1Data.version <= Date.now() + 100, 'Version should be close to current timestamp');

  // Verify DB state
  const doc1 = await SyncState.findById('global').lean();
  assert.ok(doc1);
  assert.equal(doc1.version, v1Data.version);

  // 3. bumpSync() increments afterwards
  const v2 = await bumpSync('session_saved');
  assert.equal(v2, v1Data.version + 1, 'bumpSync must increment version by 1');

  // 4. Second bumpSync() increments again
  const v3 = await bumpSync('match_completed');
  assert.equal(v3, v2 + 1, 'bumpSync must increment version by 1 again');

  // 5. getVersion() returns the incremented version without resetting
  const v3Data = await getVersion();
  assert.equal(v3Data.version, v3);
  assert.equal(v3Data.clientsCount, 0);

  // 6. Test direct initialization via bumpSync if doc absent
  await SyncState.deleteMany({ _id: 'global' });
  const midTime = Date.now();
  const vInit = await bumpSync('first_mutation');
  assert.ok(vInit >= midTime - 100);
  const vNext = await bumpSync('second_mutation');
  assert.equal(vNext, vInit + 1);

  console.log('✓ All sync unit test assertions passed successfully');
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
});
