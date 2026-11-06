// test/match-phase1.test.js
// Unit test for Phase 1: Match and MatchParticipation models
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Match = require('../src/models/Match');
const MatchParticipation = require('../src/models/MatchParticipation');
const User = require('../src/models/User');
const Player = require('../src/models/Player');

let testCoach;
let testPlayer1;
let testPlayer2;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // Setup test coach and players
  testCoach = await User.create({
    name: 'Phase 1 Coach',
    username: `p1coach_${Date.now()}`,
    email: `p1coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });

  testPlayer1 = await Player.create({
    name: 'Phase 1 Player 1',
    age: 18,
    sport: 'Football',
    coach: testCoach._id
  });

  testPlayer2 = await Player.create({
    name: 'Phase 1 Player 2',
    age: 19,
    sport: 'Football',
    coach: testCoach._id
  });
});

test.after(async () => {
  if (testCoach) {
    await Match.deleteMany({ coach: testCoach._id });
    await Player.deleteMany({ coach: testCoach._id });
    await User.findByIdAndDelete(testCoach._id);
  }
  await mongoose.disconnect();
});

test('Phase 1: Create a match and two participations; verify duplicate (match, player) throws duplicate-key error', async () => {
  // 1. Create a match
  const match = await Match.create({
    title: 'Inter-Academy Derby',
    sport: 'Football',
    date: new Date('2026-06-01'),
    time: '15:30',
    opponent: 'City Stars',
    venue: 'National Stadium',
    description: 'Quarter finals match',
    coach: testCoach._id
  });

  assert.equal(match.status, 'upcoming');
  assert.equal(match.time, '15:30');
  assert.equal(match.venue, 'National Stadium');

  // 2. Insert two participations for different players
  const p1 = await MatchParticipation.create({
    match: match._id,
    player: testPlayer1._id,
    played: null
  });
  assert.ok(p1._id);

  const p2 = await MatchParticipation.create({
    match: match._id,
    player: testPlayer2._id,
    played: null
  });
  assert.ok(p2._id);

  // 3. Confirm duplicate (match, player1) throws duplicate-key error (code 11000)
  await assert.rejects(
    async () => {
      await MatchParticipation.create({
        match: match._id,
        player: testPlayer1._id,
        played: true,
        score: 2
      });
    },
    (err) => {
      return err && (err.code === 11000 || /duplicate key/i.test(err.message));
    },
    'Expected duplicate key error on duplicate (match, player)'
  );

  // Clean up participations for this match
  await MatchParticipation.deleteMany({ match: match._id });
});

