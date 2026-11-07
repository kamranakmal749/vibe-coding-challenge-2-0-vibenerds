// client/test/stats-service.differential.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
process.env.MONGODB_URI = parityUri;

test('Differential test: src/services/statsService.js vs client/src/lib/statsService.ts produces identical outputs', async () => {
  // Connect root mongoose (used by Express statsService)
  const rootMongoose = require(path.resolve(__dirname, '../../node_modules/mongoose'));
  if (rootMongoose.connection.readyState === 0) {
    await rootMongoose.connect(parityUri);
  }

  // Connect client mongoose (used by Next.js statsService)
  const { connectToDatabase } = await import('../src/lib/db');
  const clientMongoose = await connectToDatabase();

  const Session = require('../src/lib/models/Session');
  const Player = require('../src/lib/models/Player');

  // Load Express service (CommonJS) and Next.js service (TS)
  const expressStats = require('../../src/services/statsService');
  const nextStats = await import('../src/lib/statsService');

  // Verify all 8 exported functions exist on both
  const expectedFns = [
    'calculateSessionAttendance',
    'calculateSessionTurnout',
    'calculateIndividualAttendance',
    'calculateMatchesPlayed',
    'checkTrialReadiness',
    'syncSessionMatchConflicts',
    'enrichPlayer',
    'enrichPlayersBatch'
  ];

  for (const fn of expectedFns) {
    assert.equal(typeof expressStats[fn], 'function', `Express statsService must export ${fn}`);
    assert.equal(typeof (nextStats as any)[fn], 'function', `Next.js statsService must export ${fn}`);
  }

  // 1. Differential test on a Session fixture
  const sampleSession = await Session.findOne({ saved: true }).lean();
  if (sampleSession) {
    // calculateSessionAttendance
    const expAtt = expressStats.calculateSessionAttendance(sampleSession);
    const nextAtt = nextStats.calculateSessionAttendance(sampleSession);
    assert.deepEqual(nextAtt, expAtt, 'calculateSessionAttendance output must match Express');

    // calculateSessionTurnout
    const expTurnout = await expressStats.calculateSessionTurnout(sampleSession._id);
    const nextTurnout = await nextStats.calculateSessionTurnout(sampleSession._id);
    assert.deepEqual(nextTurnout, expTurnout, 'calculateSessionTurnout output must match Express');

    // syncSessionMatchConflicts
    const expConflicts = await expressStats.syncSessionMatchConflicts(sampleSession._id);
    const nextConflicts = await nextStats.syncSessionMatchConflicts(sampleSession._id);
    assert.deepEqual(nextConflicts, expConflicts, 'syncSessionMatchConflicts output must match Express');
  }

  // 2. Differential test on Player fixtures
  const players = await Player.find({}).limit(5);
  if (players.length > 0) {
    const singlePlayer = players[0];

    // calculateIndividualAttendance
    const expInd = await expressStats.calculateIndividualAttendance(singlePlayer._id);
    const nextInd = await nextStats.calculateIndividualAttendance(singlePlayer._id);
    assert.deepEqual(nextInd, expInd, 'calculateIndividualAttendance output must match Express');

    // calculateMatchesPlayed
    const expMatches = await expressStats.calculateMatchesPlayed(singlePlayer._id);
    const nextMatches = await nextStats.calculateMatchesPlayed(singlePlayer._id);
    assert.equal(nextMatches, expMatches, 'calculateMatchesPlayed output must match Express');

    // checkTrialReadiness
    const expReady = await expressStats.checkTrialReadiness(singlePlayer._id);
    const nextReady = await nextStats.checkTrialReadiness(singlePlayer._id);
    assert.deepEqual(nextReady, expReady, 'checkTrialReadiness output must match Express');

    // enrichPlayer
    const expEnriched = await expressStats.enrichPlayer(singlePlayer);
    const nextEnriched = await nextStats.enrichPlayer(singlePlayer);
    assert.equal(nextEnriched.attendanceRate, expEnriched.attendanceRate);
    assert.equal(nextEnriched.matchesPlayed, expEnriched.matchesPlayed);
    assert.equal(nextEnriched.isReady, expEnriched.isReady);
    assert.equal(nextEnriched.performanceScore, expEnriched.performanceScore);
    assert.equal(nextEnriched.hasPerformanceStar, expEnriched.hasPerformanceStar);

    // enrichPlayersBatch
    const expBatch = await expressStats.enrichPlayersBatch(players);
    const nextBatch = await nextStats.enrichPlayersBatch(players);
    assert.equal(nextBatch.length, expBatch.length);
    for (let i = 0; i < expBatch.length; i++) {
      assert.equal(nextBatch[i].attendanceRate, expBatch[i].attendanceRate);
      assert.equal(nextBatch[i].matchesPlayed, expBatch[i].matchesPlayed);
      assert.equal(nextBatch[i].isReady, expBatch[i].isReady);
      assert.equal(nextBatch[i].performanceScore, expBatch[i].performanceScore);
    }
  }

  console.log('✓ Differential test passed: all 8 functions return identical outputs on academy_parity data');
  await rootMongoose.disconnect();
  await clientMongoose.disconnect();
});
