// client/test/player-id-ist.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const Player = require('../src/lib/models/Player');
const User = require('../src/lib/models/User');
const Counter = require('../src/lib/models/Counter');

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(parityUri);
  }
});

test.after(async () => {
  await mongoose.disconnect();
});

test('Player Model: registeredOn 2026-12-31T20:00:00Z generates year "27" (md27xxxx) regardless of host TZ', async () => {
  const coach = await User.create({
    name: 'Year Rollover Coach',
    username: `coach_rollover_${Date.now()}`,
    email: `coach_rollover_${Date.now()}@example.com`,
    password: 'password123',
    role: 'coach'
  });

  const realNow = Date.now;
  // Mock Date.now to 2026-12-31T20:05:00Z so registeredOn passes future-date validator
  Date.now = () => new Date('2026-12-31T20:05:00Z').getTime();

  let player: any;
  const counterBefore = await Counter.findOne({ key: 'player_27' });
  const initialSeq = counterBefore ? counterBefore.seq : 0;

  try {
    const registeredOn = new Date('2026-12-31T20:00:00Z');
    player = await Player.create({
      name: 'New Year Player',
      sport: 'Football',
      age: 16,
      coach: coach._id,
      registeredOn
    });

    assert.ok(player.playerId, 'Player must have an auto-generated playerId');
    assert.ok(player.playerId.startsWith('md27'), `Expected playerId to start with 'md27', got ${player.playerId}`);
    assert.match(player.playerId, /^md27\d{4}$/, `Expected playerId to match ^md27\\d{4}$, got ${player.playerId}`);

    const counterAfter = await Counter.findOne({ key: 'player_27' });
    assert.ok(counterAfter, 'Counter document for player_27 must exist');
    assert.equal(counterAfter.seq, initialSeq + 1, 'Counter seq must increment by exactly 1');
    const expectedSuffix = String(counterAfter.seq).padStart(4, '0');
    assert.equal(player.playerId, `md27${expectedSuffix}`, `Player ID suffix must match sequence ${expectedSuffix}`);

    console.log(`Verified playerId ${player.playerId} and counter seq ${counterAfter.seq} (Host TZ: ${process.env.TZ || 'system'})`);
  } finally {
    Date.now = realNow;
    if (player?._id) {
      await Player.findByIdAndDelete(player._id);
    }
    await User.findByIdAndDelete(coach._id);

    // Counter-safe restoration
    if (counterBefore) {
      await Counter.updateOne({ key: 'player_27' }, { $set: { seq: initialSeq } });
    } else {
      await Counter.deleteOne({ key: 'player_27' });
    }
  }
});
