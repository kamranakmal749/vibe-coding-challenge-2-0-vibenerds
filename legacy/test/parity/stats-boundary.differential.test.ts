// client/test/stats-boundary.differential.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');

// Express root services & models
const rootMongoose = require(path.resolve(__dirname, '../../node_modules/mongoose'));
const expressStatsService = require(path.resolve(__dirname, '../../src/services/statsService'));
const RootUser = require(path.resolve(__dirname, '../../src/models/User'));
const RootPlayer = require(path.resolve(__dirname, '../../src/models/Player'));
const RootSession = require(path.resolve(__dirname, '../../src/models/Session'));
const RootMatch = require(path.resolve(__dirname, '../../src/models/Match'));
const RootMatchParticipation = require(path.resolve(__dirname, '../../src/models/MatchParticipation'));

// Next.js client services & models
import * as nextStatsService from '../src/lib/statsService';
import connectToDatabase from '../src/lib/db';

test.before(async () => {
  if (rootMongoose.connection.readyState === 0) {
    await rootMongoose.connect(parityUri);
  }
  await connectToDatabase();
});

test.after(async () => {
  try { await rootMongoose.disconnect(); } catch (_) {}
  try { await mongoose.disconnect(); } catch (_) {}
});

test('Stats Boundary Test: Month boundary fixtures at 18:29 UTC and 23:30 UTC', async () => {
  const hostTz = process.env.TZ || 'system';
  console.log(`\n--- Running boundary test with Host TZ: ${hostTz} ---`);

  // Freeze clock to Nov 1, 2026 12:00:00 UTC
  const realNow = Date.now;
  Date.now = () => new Date('2026-11-01T12:00:00.000Z').getTime();

  // Create coach & player
  const coach = await RootUser.create({
    name: 'Boundary Coach',
    username: `bcoach_${Date.now()}`,
    email: `bcoach_${Date.now()}@example.com`,
    password: 'password123',
    role: 'coach'
  });

  const player = await RootPlayer.create({
    name: 'Boundary Player',
    sport: 'Football',
    age: 17,
    coach: coach._id,
    registeredOn: new Date('2026-10-01T00:00:00.000Z')
  });

  // Session on Nov 1, 2026 (stored at UTC midnight 2026-11-01T00:00:00.000Z = 05:30 IST)
  // Player is ABSENT in this session
  const sessionNov1 = await RootSession.create({
    coach: coach._id,
    sport: 'Football',
    date: new Date('2026-11-01T00:00:00.000Z'),
    saved: true,
    locked: true,
    attendance: [{
      player: player._id,
      status: 'absent',
      participation: 'both'
    }]
  });

  // Match 1: At 18:29 UTC on Oct 31 (= 23:59 IST on Oct 31, previous month)
  const matchOct31 = await RootMatch.create({
    coach: coach._id,
    sport: 'Football',
    title: 'Oct 31 Match',
    date: new Date('2026-10-31T18:29:00.000Z'),
    time: '23:59',
    opponent: 'Opponent Oct',
    venue: 'Ground A',
    status: 'completed'
  });

  // Match 2: At 23:30 UTC on Oct 31 (= 05:00 AM IST on Nov 1, current month in IST!)
  const matchNov1IST = await RootMatch.create({
    coach: coach._id,
    sport: 'Football',
    title: 'Nov 1 Early Morning IST Match',
    date: new Date('2026-10-31T23:30:00.000Z'),
    time: '05:00',
    opponent: 'Opponent Nov',
    venue: 'Ground B',
    status: 'completed'
  });

  // Create participation for player in Match 2
  const partNov1 = await RootMatchParticipation.create({
    match: matchNov1IST._id,
    player: player._id,
    played: true,
    score: 1,
    attendanceConflict: false
  });

  try {
    // Run syncSessionMatchConflicts on sessionNov1 using both services
    // 1. Next.js sync
    const nextConflictResult = await nextStatsService.syncSessionMatchConflicts(sessionNov1._id.toString());
    const nextMatchReloaded = await RootMatch.findById(matchNov1IST._id);
    const nextPartReloaded = await RootMatchParticipation.findById(partNov1._id);

    console.log(`[Next.js] Session Nov 1 conflict detection for 23:30 UTC (05:00 IST):`, {
      conflictsCount: nextConflictResult.conflictsCount,
      matchHasConflict: nextMatchReloaded.hasConflict,
      partHasConflict: nextPartReloaded.attendanceConflict
    });

    // Reset match & part conflict
    matchNov1IST.hasConflict = false;
    matchNov1IST.conflictMessage = '';
    await matchNov1IST.save();
    partNov1.attendanceConflict = false;
    await partNov1.save();

    // 2. Express sync
    const expressConflictResult = await expressStatsService.syncSessionMatchConflicts(sessionNov1._id.toString());
    const expressMatchReloaded = await RootMatch.findById(matchNov1IST._id);
    const expressPartReloaded = await RootMatchParticipation.findById(partNov1._id);

    console.log(`[Express] Session Nov 1 conflict detection for 23:30 UTC (05:00 IST):`, {
      conflictsCount: expressConflictResult.conflictsCount,
      matchHasConflict: expressMatchReloaded.hasConflict,
      partHasConflict: expressPartReloaded.attendanceConflict
    });

    if (hostTz === 'Asia/Kolkata') {
      // Under Asia/Kolkata, Express setHours(0,0,0,0) evaluates in IST (+5:30), matching Next.js exactly!
      assert.deepStrictEqual(
        nextConflictResult,
        expressConflictResult,
        'Under TZ=Asia/Kolkata, Express and Next.js must produce 100% IDENTICAL results'
      );
      assert.equal(nextMatchReloaded.hasConflict, expressMatchReloaded.hasConflict);
      console.log('✓ Under TZ=Asia/Kolkata: Express and Next.js are 100% IDENTICAL!');
    } else {
      // Under TZ=UTC:
      // Express setHours(0,0,0,0) uses UTC, so minTime = 2026-11-01T00:00:00Z.
      // 2026-10-31T23:30:00Z is BEFORE minTime in UTC, so Express misses the match!
      // Next.js uses ist.ts (explicit UTC+05:30), so minDate = 2026-10-31T18:30:00Z, correctly catching the 05:00 IST match!
      console.log('--- TZ=UTC Comparison ---');
      console.log(`Express conflictsCount: ${expressConflictResult.conflictsCount} (Missed match because UTC < 00:00)`);
      console.log(`Next.js conflictsCount: ${nextConflictResult.conflictsCount} (Correctly caught match at 05:00 IST)`);
      assert.equal(nextConflictResult.conflictsCount, 1, 'Next.js must catch the 05:00 IST conflict');
      assert.equal(nextMatchReloaded.hasConflict, true, 'Next.js must flag match conflict');
    }
  } finally {
    Date.now = realNow;
    await RootMatchParticipation.deleteMany({ match: { $in: [matchOct31._id, matchNov1IST._id] } });
    await RootMatch.deleteMany({ _id: { $in: [matchOct31._id, matchNov1IST._id] } });
    await RootSession.findByIdAndDelete(sessionNov1._id);
    await RootPlayer.findByIdAndDelete(player._id);
    await RootUser.findByIdAndDelete(coach._id);
  }
});
