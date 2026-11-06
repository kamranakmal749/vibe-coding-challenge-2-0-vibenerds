const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const BASE_URL = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : 'http://localhost:3000';
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

test('12-Step Match Management Verification Flow', async (t) => {
  // Connect mongoose to resolve coach and players
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  const User = require('../src/models/User');
  const Player = require('../src/models/Player');
  const Session = require('../src/models/Session');

  // Find or create coach
  let coach = await User.findOne({ role: 'coach' });
  if (!coach) {
    coach = await User.create({
      name: 'Test Coach',
      username: `coach_${Date.now()}`,
      email: `coach_${Date.now()}@example.com`,
      password: 'password123',
      role: 'coach'
    });
  }

  const token = jwt.sign({ id: coach._id, role: 'coach', name: coach.name }, JWT_SECRET);
  const coachHeader = { Authorization: `Bearer ${token}` };

  // Setup: Make sure there is a training session on today's date with players marked present
  const todayIso = new Date().toISOString().split('T')[0];
  
  // Fetch existing players
  const playersRes = await req('/api/players', { headers: coachHeader });
  assert.equal(playersRes.status, 200);
  const footballPlayers = playersRes.data.filter(p => p.sport === 'Football');
  assert.ok(footballPlayers.length >= 2, 'Should have at least 2 football players');

  const player1 = footballPlayers[0];
  const player2 = footballPlayers[1];

  const p1MatchesBefore = player1.matchesPlayed || 0;
  const p2MatchesBefore = player2.matchesPlayed || 0;

  // Make sure players belong to this coach
  await Player.updateMany({ _id: { $in: [player1._id, player2._id] } }, { coach: coach._id });

  // Create or verify session on today's date
  const createSessionRes = await req('/api/sessions', {
    method: 'POST',
    headers: coachHeader,
    body: JSON.stringify({
      sport: 'Football',
      date: todayIso,
      time: '08:00',
      attendance: [
        { player: player1._id, status: 'present', participation: 'both' },
        { player: player2._id, status: 'present', participation: 'both' }
      ]
    })
  });
  let sessionId = createSessionRes.data?._id;
  if (!sessionId) {
    const listSessions = await req('/api/sessions', { headers: coachHeader });
    const sess = listSessions.data.find(s => s.sport === 'Football' && s.date.startsWith(todayIso));
    if (sess) sessionId = sess._id;
  }
  if (sessionId) {
    await req(`/api/sessions/${sessionId}/attendance`, {
      method: 'POST',
      headers: coachHeader,
      body: JSON.stringify({
        attendance: [
          { player: player1._id, status: 'present', participation: 'both' },
          { player: player2._id, status: 'present', participation: 'both' }
        ]
      })
    });
    // Finalize/save attendance so it counts as saved session
    await req(`/api/sessions/${sessionId}/save`, {
      method: 'PATCH',
      headers: coachHeader,
      body: JSON.stringify({
        attendance: [
          { player: player1._id, status: 'present', participation: 'both' },
          { player: player2._id, status: 'present', participation: 'both' }
        ]
      })
    });
  }

  let testMatchId = null;

  // Step 1: Create a match (scheduled in the morning so scoring is unlocked by current time)
  const matchTitle = `Championship Final 12Step ${Date.now()}`;
  const matchTime = '08:00';
  const matchOpponent = `Thunderbolts_${Date.now()}`;

  await t.test('Step 1: Create a match (only details, initial status Upcoming)', async () => {
    const res = await req('/api/matches', {
      method: 'POST',
      headers: coachHeader,
      body: JSON.stringify({
        title: matchTitle,
        sport: 'Football',
        date: todayIso,
        time: matchTime,
        opponent: matchOpponent,
        venue: 'Main Arena',
        description: 'Verification match flow'
      })
    });
    assert.equal(res.status, 201, 'Match should be created with status 201');
    assert.equal(res.data.status, 'upcoming', 'Initial status must be upcoming');
    testMatchId = res.data._id;
    assert.ok(testMatchId, 'Match ID must be returned');
    console.log('  ✅ Step 1: Match created successfully with status: upcoming');
  });

  // Step 2: Verify it appears in Upcoming Matches
  await t.test('Step 2: Verify it appears in Upcoming Matches', async () => {
    const res = await req('/api/matches', { headers: coachHeader });
    assert.equal(res.status, 200);
    const upcoming = res.data.filter(m => m.status === 'upcoming');
    const found = upcoming.find(m => m._id.toString() === testMatchId);
    assert.ok(found, 'Created match must appear in Upcoming Matches');
    console.log('  ✅ Step 2: Match found in Upcoming Matches list');
  });

  // Step 3: Open the upcoming match
  await t.test('Step 3: Open the upcoming match', async () => {
    const res = await req(`/api/matches/${testMatchId}`, { headers: coachHeader });
    assert.equal(res.status, 200);
    assert.equal(res.data.title, matchTitle);
    assert.equal(res.data.status, 'upcoming');
    console.log('  ✅ Step 3: Match details retrieved successfully');
  });

  // Step 4: Select eligible players
  await t.test('Step 4: Select eligible players', async () => {
    const eligibleRes = await req(`/api/matches/${testMatchId}/eligible-players`, { headers: coachHeader });
    assert.equal(eligibleRes.status, 200);
    const eligibleList = eligibleRes.data.players || eligibleRes.data || [];
    const eligibleIds = eligibleList.map(p => (p.playerId || p._id).toString());
    assert.ok(eligibleIds.includes(player1._id.toString()), 'Player 1 should be eligible');
    assert.ok(eligibleIds.includes(player2._id.toString()), 'Player 2 should be eligible');

    const selectRes = await req(`/api/matches/${testMatchId}/selected-players`, {
      method: 'PUT',
      headers: coachHeader,
      body: JSON.stringify({ playerIds: [player1._id.toString(), player2._id.toString()] })
    });
    assert.equal(selectRes.status, 200);
    console.log('  ✅ Step 4: Selected 2 eligible players for match squad');
  });

  // Step 5 & 6 & 7: Mark some Played, others Not Played, enter scores, save data
  await t.test('Step 5, 6, 7: Mark Player 1 Played (score 3) and Player 2 Not Played, save data', async () => {
    // Player 1 played with score 3
    const p1Res = await req(`/api/matches/${testMatchId}/participation/${player1._id}`, {
      method: 'PATCH',
      headers: coachHeader,
      body: JSON.stringify({ played: true, score: 3, remarks: 'Hat-trick hero' })
    });
    assert.equal(p1Res.status, 200);
    assert.equal(p1Res.data.participation.played, true);
    assert.equal(p1Res.data.participation.score, 3);

    // Player 2 not played
    const p2Res = await req(`/api/matches/${testMatchId}/participation/${player2._id}`, {
      method: 'PATCH',
      headers: coachHeader,
      body: JSON.stringify({ played: false, score: null, remarks: 'Benched for tactical reasons' })
    });
    assert.equal(p2Res.status, 200);
    assert.equal(p2Res.data.participation.played, false);
    assert.equal(p2Res.data.participation.score, null);
    console.log('  ✅ Step 5, 6, 7: Participation and scores saved in MongoDB');
  });

  // Step 8: Complete the match
  await t.test('Step 8: Complete the match', async () => {
    const compRes = await req(`/api/matches/${testMatchId}/complete`, {
      method: 'PATCH',
      headers: coachHeader
    });
    assert.equal(compRes.status, 200);
    assert.equal(compRes.data.match.status, 'completed');
    console.log('  ✅ Step 8: Match status updated to completed');
  });

  // Step 9: Open Completed Matches
  await t.test('Step 9: Open Completed Matches', async () => {
    const res = await req('/api/matches', { headers: coachHeader });
    assert.equal(res.status, 200);
    const completedMatches = res.data.filter(m => m.status === 'completed');
    const found = completedMatches.find(m => m._id.toString() === testMatchId);
    assert.ok(found, 'Match must appear in Completed Matches list');
    console.log('  ✅ Step 9: Match found in Completed Matches');
  });

  // Step 10: Verify all player participation and scores are visible in Completed Matches
  await t.test('Step 10: Verify all player participation and scores are visible', async () => {
    const res = await req(`/api/matches/${testMatchId}`, { headers: coachHeader });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'completed');
    assert.ok(res.data.participations, 'Participations array must be returned');

    const p1Part = res.data.participations.find(p => (p.player?._id || p.player).toString() === player1._id.toString());
    const p2Part = res.data.participations.find(p => (p.player?._id || p.player).toString() === player2._id.toString());

    assert.ok(p1Part, 'Player 1 participation must be present');
    assert.equal(p1Part.played, true);
    assert.equal(p1Part.score, 3);
    assert.equal(p1Part.remarks, 'Hat-trick hero');
    assert.ok(p1Part.player?.name, 'Player 1 name must be populated');

    assert.ok(p2Part, 'Player 2 participation must be present');
    assert.equal(p2Part.played, false);
    assert.equal(p2Part.score, null);
    assert.ok(p2Part.player?.name, 'Player 2 name must be populated');

    // Also check GET /api/matches list endpoint returns participations
    const listRes = await req('/api/matches', { headers: coachHeader });
    const listMatch = listRes.data.find(m => m._id.toString() === testMatchId);
    assert.ok(listMatch.participations, 'List match must include participations');
    const listP1 = listMatch.participations.find(p => (p.player?._id || p.player).toString() === player1._id.toString());
    assert.equal(listP1.score, 3);

    console.log('  ✅ Step 10: Player participation & scores verified in Completed Matches');
  });

  // Step 11: Refresh and verify data remains permanently
  await t.test('Step 11: Refresh and verify permanent persistence', async () => {
    const res = await req(`/api/matches/${testMatchId}`, { headers: coachHeader });
    assert.equal(res.status, 200);
    const p1Part = res.data.participations.find(p => (p.player?._id || p.player).toString() === player1._id.toString());
    assert.equal(p1Part.played, true);
    assert.equal(p1Part.score, 3);
    console.log('  ✅ Step 11: Fresh read confirmed permanent MongoDB persistence');
  });

  // Step 12: Verify that matchesPlayed increases ONLY for players who actually played
  await t.test('Step 12: Verify matchesPlayed increases only for player who actually played', async () => {
    const p1Fresh = await req(`/api/players/${player1._id}`, { headers: coachHeader });
    const p2Fresh = await req(`/api/players/${player2._id}`, { headers: coachHeader });

    const p1MatchesAfter = p1Fresh.data.matchesPlayed;
    const p2MatchesAfter = p2Fresh.data.matchesPlayed;

    assert.equal(p1MatchesAfter, p1MatchesBefore + 1, 'Player 1 (Played=true) matchesPlayed MUST increase by 1');
    assert.equal(p2MatchesAfter, p2MatchesBefore, 'Player 2 (Played=false) matchesPlayed MUST NOT increase');
    console.log(`  ✅ Step 12: Player 1 matchesPlayed: ${p1MatchesBefore} -> ${p1MatchesAfter} (+1)`);
    console.log(`  ✅ Step 12: Player 2 matchesPlayed: ${p2MatchesBefore} -> ${p2MatchesAfter} (+0)`);
  });

  t.after(async () => {
    await mongoose.disconnect();
  });
});
