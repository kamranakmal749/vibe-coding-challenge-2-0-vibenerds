const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

async function req(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('Time-Based Match Management & 60-Minute Scoring Unlock Workflow', async (t) => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  const User = require('../src/models/User');
  const Player = require('../src/models/Player');
  const Match = require('../src/models/Match');
  const MatchParticipation = require('../src/models/MatchParticipation');

  let coach = await User.findOne({ role: 'coach' });
  if (!coach) {
    coach = await User.create({
      name: 'Time Coach',
      username: `time_coach_${Date.now()}`,
      email: `time_coach_${Date.now()}@example.com`,
      password: 'password123',
      role: 'coach'
    });
  }
  const coachToken = jwt.sign({ id: coach._id, role: 'coach', name: coach.name }, JWT_SECRET);
  const H = (mockTime = null) => {
    const headers = { Authorization: `Bearer ${coachToken}` };
    if (mockTime) headers['x-mock-now'] = mockTime.toISOString();
    return headers;
  };

  const testDateStr = '2026-11-05';
  const matchTimeStr = '17:00'; // 5:00 PM kickoff

  // Local dates for simulation:
  // Kickoff: Nov 5, 2026 17:00:00 (5:00 PM)
  // 4:59 PM: Nov 5, 2026 16:59:00
  // 5:30 PM: Nov 5, 2026 17:30:00
  // 5:59 PM: Nov 5, 2026 17:59:00
  // 6:00 PM: Nov 5, 2026 18:00:00
  const [y, m, d] = testDateStr.split('-').map(Number);
  const time459 = new Date(y, m - 1, d, 16, 59, 0, 0);
  const time530 = new Date(y, m - 1, d, 17, 30, 0, 0);
  const time559 = new Date(y, m - 1, d, 17, 59, 0, 0);
  const time600 = new Date(y, m - 1, d, 18, 0, 0, 0);
  const time605 = new Date(y, m - 1, d, 18, 5, 0, 0);

  // Setup 2 players
  let player1 = await Player.findOne({ sport: 'Football' });
  if (!player1) {
    player1 = await Player.create({ name: 'Striker Time', age: 20, sport: 'Football', coach: coach._id });
  } else {
    await Player.updateOne({ _id: player1._id }, { coach: coach._id });
  }

  let testMatchId = null;

  // 1. Match Creation: Scheduled for 5:00 PM on 2026-11-05
  await t.test('1. Match Creation — Initial status Upcoming, only basic details collected', async () => {
    const res = await req('/api/matches', {
      method: 'POST',
      headers: H(time459),
      body: JSON.stringify({
        title: `Time Test Cup ${Date.now()}`,
        sport: 'Football',
        date: testDateStr,
        time: matchTimeStr,
        opponent: `Rivals_${Date.now()}`,
        venue: 'Metro Arena',
        description: 'Time scheduled match test'
      })
    });
    assert.equal(res.status, 201, 'Match created with 201');
    assert.equal(res.data.status, 'upcoming', 'Initial status must be upcoming');
    testMatchId = res.data._id;
    console.log('  ✅ Match created with status: upcoming, scheduled for 5:00 PM');
  });

  // Squad selection
  await t.test('1b. Squad Selection — Add player to squad before match time', async () => {
    await Match.updateOne({ _id: testMatchId }, { selectedPlayers: [player1._id] });
    console.log('  ✅ Player added to squad');
  });

  // 2. Status & Lock check at 4:59 PM (Before 5:00 PM kickoff: Upcoming, Scoring Locked)
  await t.test('2. At 4:59 PM — Status Upcoming, Scoring is Locked (HTTP 403)', async () => {
    const getRes = await req(`/api/matches/${testMatchId}`, { headers: H(time459) });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.timeStatus, 'upcoming', 'At 4:59 PM timeStatus must be upcoming');
    assert.equal(getRes.data.isScoringUnlocked, false, 'Scoring must be locked at 4:59 PM');

    // Attempting to record participation/score early must be rejected by backend
    const patchRes = await req(`/api/matches/${testMatchId}/participation/${player1._id}`, {
      method: 'PATCH',
      headers: H(time459),
      body: JSON.stringify({ played: true, score: 1 })
    });
    assert.equal(patchRes.status, 403, 'Early scoring attempt at 4:59 PM must return HTTP 403 Forbidden');
    assert.match(patchRes.data.error, /locked/i, 'Error message must state scoring is locked');
    console.log('  ✅ At 4:59 PM: status is Upcoming, early scoring rejected with 403');
  });

  // 3. Status & Lock check at 5:30 PM (Match In Progress, kickoff passed but < 60 min: Scoring Locked)
  await t.test('3. At 5:30 PM — Status In Progress, Scoring is still Locked (HTTP 403)', async () => {
    const getRes = await req(`/api/matches/${testMatchId}`, { headers: H(time530) });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.timeStatus, 'in_progress', 'At 5:30 PM timeStatus must be in_progress');
    assert.equal(getRes.data.isScoringUnlocked, false, 'Scoring must still be locked at 5:30 PM');

    // Attempting early score must be rejected
    const patchRes = await req(`/api/matches/${testMatchId}/participation/${player1._id}`, {
      method: 'PATCH',
      headers: H(time530),
      body: JSON.stringify({ played: true, score: 2 })
    });
    assert.equal(patchRes.status, 403, 'Scoring attempt at 5:30 PM must return HTTP 403 Forbidden');

    // Attempting early completion must also be rejected
    const compRes = await req(`/api/matches/${testMatchId}/complete`, {
      method: 'PATCH',
      headers: H(time530)
    });
    assert.equal(compRes.status, 403, 'Early completion attempt at 5:30 PM must return HTTP 403 Forbidden');
    console.log('  ✅ At 5:30 PM: status is In Progress, scoring and completion rejected with 403');
  });

  // 4. Status & Lock check at 5:59 PM (Kickoff + 59 min: Scoring STILL Locked)
  await t.test('4. At 5:59 PM — Status In Progress, Scoring is still Locked (HTTP 403)', async () => {
    const getRes = await req(`/api/matches/${testMatchId}`, { headers: H(time559) });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.timeStatus, 'in_progress', 'At 5:59 PM timeStatus must be in_progress');
    assert.equal(getRes.data.isScoringUnlocked, false, 'Scoring must still be locked at 5:59 PM');

    const patchRes = await req(`/api/matches/${testMatchId}/participation/${player1._id}`, {
      method: 'PATCH',
      headers: H(time559),
      body: JSON.stringify({ played: true, score: 2 })
    });
    assert.equal(patchRes.status, 403, 'Scoring attempt at 5:59 PM must return HTTP 403 Forbidden');
    console.log('  ✅ At 5:59 PM: status is In Progress, scoring still locked (403)');
  });

  // 5. At 6:00 PM — Scoring Unlocks (scheduledDateTime + 60 minutes)
  await t.test('5. At 6:00 PM — Scoring Unlocks (HTTP 200 accepted)', async () => {
    const getRes = await req(`/api/matches/${testMatchId}`, { headers: H(time600) });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.timeStatus, 'scoring_available', 'At 6:00 PM timeStatus must be scoring_available');
    assert.equal(getRes.data.isScoringUnlocked, true, 'Scoring must unlock at 6:00 PM');

    // Entering scores at 6:00 PM must succeed
    const patchRes = await req(`/api/matches/${testMatchId}/participation/${player1._id}`, {
      method: 'PATCH',
      headers: H(time600),
      body: JSON.stringify({ played: true, score: 3, remarks: 'Winning goal at 6 PM' })
    });
    assert.equal(patchRes.status, 200, 'Scoring at 6:00 PM must be accepted with HTTP 200');
    assert.equal(patchRes.data.participation.score, 3);
    console.log('  ✅ At 6:00 PM: scoring is unlocked, score of 3 saved successfully to MongoDB');
  });

  // 6. Complete Match after 6:00 PM and verify Completed Matches display permanently
  await t.test('6. Complete Match after unlock & verify Completed Matches display', async () => {
    const compRes = await req(`/api/matches/${testMatchId}/complete`, {
      method: 'PATCH',
      headers: H(time605)
    });
    assert.equal(compRes.status, 200, 'Completion after unlock must succeed');
    assert.equal(compRes.data.match.status, 'completed');

    // Verify it appears in Completed Matches list
    const listRes = await req('/api/matches', { headers: H(time605) });
    assert.equal(listRes.status, 200);
    const compMatch = listRes.data.find(m => m._id.toString() === testMatchId);
    assert.ok(compMatch, 'Must appear in completed matches list');
    assert.equal(compMatch.status, 'completed');
    assert.ok(compMatch.participations, 'Participations must be returned');

    const pPart = compMatch.participations.find(p => (p.player?._id || p.player).toString() === player1._id.toString());
    assert.ok(pPart, 'Player participation must be present');
    assert.equal(pPart.played, true);
    assert.equal(pPart.score, 3);
    console.log('  ✅ Match completed and verified in Completed Matches list with score 3');
  });

  // 7. Refresh check — permanent persistence in MongoDB
  await t.test('7. Refresh check — permanent persistence in MongoDB after completion', async () => {
    const getRes = await req(`/api/matches/${testMatchId}`, { headers: H() });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.status, 'completed');
    const pPart = getRes.data.participations.find(p => (p.player?._id || p.player).toString() === player1._id.toString());
    assert.equal(pPart.played, true);
    assert.equal(pPart.score, 3);
    assert.equal(pPart.remarks, 'Winning goal at 6 PM');
    console.log('  ✅ Fresh fetch verified permanent persistence of scores');
  });

  // 8. Rescheduling test: rescheduling an upcoming match recalculates unlock time
  await t.test('8. Rescheduling test — updating time recalculates unlock time', async () => {
    const res = await req('/api/matches', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        title: `Reschedule Test ${Date.now()}`,
        sport: 'Football',
        date: testDateStr,
        time: '19:00',
        opponent: `Future_${Date.now()}`,
        venue: 'Metro Ground'
      })
    });
    assert.equal(res.status, 201);
    const mId = res.data._id;

    // Reschedule kickoff from 19:00 to 20:30
    const patchRes = await req(`/api/matches/${mId}`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify({ time: '20:30' })
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.data.time, '20:30');

    // New unlock time should be 21:30 (kickoff 20:30 + 60m)
    const newUnlock = new Date(patchRes.data.unlockDateTime);
    assert.equal(newUnlock.getHours(), 21);
    assert.equal(newUnlock.getMinutes(), 30);
    console.log('  ✅ Rescheduling to 20:30 correctly recalculated unlock time to 21:30 (Kickoff + 60m)');
  });

  t.after(async () => {
    await mongoose.disconnect();
  });
});

