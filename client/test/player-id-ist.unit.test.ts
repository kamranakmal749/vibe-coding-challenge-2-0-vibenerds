// client/test/player-id-ist.unit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import path from 'path';

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const Player = require('../src/lib/models/Player');
const User = require('../src/lib/models/User');

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
    console.log(`Generated playerId for registeredOn 2026-12-31T20:00:00Z (Host TZ: ${process.env.TZ || 'system'}): ${player.playerId}`);
    assert.match(player.playerId, /^md27\d{4}$/, `Expected playerId to begin with md27, got ${player.playerId}`);
  } finally {
    Date.now = realNow;
    if (player?._id) {
      await Player.findByIdAndDelete(player._id);
    }
    await User.findByIdAndDelete(coach._id);
  }
});
