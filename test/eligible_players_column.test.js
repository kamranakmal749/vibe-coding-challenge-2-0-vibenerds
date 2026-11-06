// test/eligible_players_column.test.js
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL = 'http://localhost:3000';
let coachToken = null;
let coachId = null;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (coachToken) headers['Authorization'] = `Bearer ${coachToken}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Eligible Players Column & No Squad Size Limit Verification', async (t) => {
  // Step 0: Coach Login
  await t.test('0. Coach Login', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'coach', password: 'coach123' })
    });
    assert.equal(res.status, 200);
    coachToken = res.data.token;
    coachId = res.data.user.id;
  });

  // Step 1: Use existing 5 Football players for a test session
  const playersRes = await api('/api/players');
  assert.equal(playersRes.status, 200);
  const footballPlayers = (playersRes.data || []).filter(p => p.sport === 'Football');
  assert.ok(footballPlayers.length >= 5, 'Must have at least 5 registered football players');

  const selectedFive = footballPlayers.slice(0, 5);
  const remainingPlayers = footballPlayers.slice(5);

  const testSuffix = Date.now().toString().slice(-5);
  const randomDay = 15 + Math.floor(Math.random() * 10);
  const matchDate = `2026-11-${randomDay}`;
  let matchId = null;
  let sessionId = null;

  await t.test('1. Setup practice session with exactly 5 players Present', async () => {
    const attendancePayload = [
      ...selectedFive.map(p => ({ playerId: p._id, status: 'present', participation: 'both' })),
      ...remainingPlayers.map(p => ({ playerId: p._id, status: 'absent', participation: 'both' }))
    ];

    const sessRes = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        title: `Practice_${testSuffix}`,
        sport: 'Football',
        date: matchDate,
        time: '08:00',
        venue: 'Main Ground',
        attendance: attendancePayload
      })
    });
    assert.equal(sessRes.status, 201);
    sessionId = sessRes.data._id;

    // Save attendance so it is finalized
    const saveRes = await api(`/api/sessions/${sessionId}/save`, {
      method: 'PATCH',
      body: JSON.stringify({ attendance: attendancePayload })
    });
    assert.equal(saveRes.status, 200);
  });

  await t.test('2. Create match without any Maximum Squad Size field', async () => {
    const createRes = await api('/api/matches', {
      method: 'POST',
      body: JSON.stringify({
        title: `Test Match ${testSuffix}`,
        sport: 'Football',
        date: matchDate,
        time: '15:00',
        opponent: `Opponent ${testSuffix}`,
        venue: 'City Stadium',
        description: 'Testing eligible players count'
      })
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.data.status, 'upcoming');
    matchId = createRes.data._id;
  });

  await t.test('3. Verify Upcoming Matches API returns totalEligiblePlayers: 5', async () => {
    const listRes = await api('/api/matches?status=upcoming');
    assert.equal(listRes.status, 200);
    const found = (listRes.data.matches || listRes.data).find(m => m._id === matchId);
    assert.ok(found, 'Match must be present in upcoming matches list');
    assert.equal(found.totalEligiblePlayers, 5, 'totalEligiblePlayers must be exactly 5 based on attendance');
  });

  await t.test('4. Verify Match Details API returns totalEligiblePlayers: 5 consistently', async () => {
    const detailRes = await api(`/api/matches/${matchId}`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.totalEligiblePlayers, 5, 'Match details must also return 5 eligible players');
  });

  await t.test('5. Verify no squad size limit: Coach can select all 5 eligible players', async () => {
    const allFiveIds = selectedFive.map(p => p._id);
    const selectRes = await api(`/api/matches/${matchId}/selected-players`, {
      method: 'PUT',
      body: JSON.stringify({ playerIds: allFiveIds })
    });
    assert.equal(selectRes.status, 200, 'Selecting all 5 players without squad size cap must succeed');
    assert.equal(selectRes.data.match.selectedPlayers.length, 5);
  });

  await t.test('6. Clean up test match and session', async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    const Match = require('../src/models/Match');
    const Session = require('../src/models/Session');
    const MatchParticipation = require('../src/models/MatchParticipation');

    if (matchId) {
      await MatchParticipation.deleteMany({ match: matchId });
      await Match.deleteOne({ _id: matchId });
    }
    if (sessionId) {
      await Session.deleteOne({ _id: sessionId });
    }
    await mongoose.disconnect();
  });
});
