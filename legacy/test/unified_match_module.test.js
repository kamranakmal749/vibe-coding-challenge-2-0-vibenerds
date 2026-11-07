// test/unified_match_module.test.js
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : 'http://localhost:3000';
let coachToken = null;
let coachId = null;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (coachToken) headers['Authorization'] = `Bearer ${coachToken}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Unified Match Management Module Verification', async (t) => {
  // Step 0: Login as coach
  await t.test('0. Coach Login', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'coach', password: 'coach123' })
    });
    assert.equal(res.status, 200, 'Coach login should succeed');
    coachToken = res.data.token;
    coachId = res.data.user.id;
    assert.ok(coachToken, 'Token received');
  });

  const testSuffix = Date.now().toString().slice(-6);
  const randomDay = 10 + (Math.floor(Math.random() * 18));
  const matchDate = `2026-12-${randomDay}`;
  const matchKickoff = '14:00'; // 2:00 PM
  let player1Id, player2Id, player3Id, player4Id;
  let testMatchId = null;

  // Step 1: Create 4 players and a practice session where 3 are Present and 1 is Absent
  await t.test('1. Setup Players and Practice Attendance', async () => {
    const p1 = await api('/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: `P1_Unified_${testSuffix}`, age: 19, sport: 'Football', defaultParticipation: 'both' })
    });
    const p2 = await api('/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: `P2_Unified_${testSuffix}`, age: 20, sport: 'Football', defaultParticipation: 'both' })
    });
    const p3 = await api('/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: `P3_Unified_${testSuffix}`, age: 21, sport: 'Football', defaultParticipation: 'both' })
    });
    const p4 = await api('/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: `P4_Absent_${testSuffix}`, age: 22, sport: 'Football', defaultParticipation: 'both' })
    });

    assert.equal(p1.status, 201);
    assert.equal(p2.status, 201);
    assert.equal(p3.status, 201);
    assert.equal(p4.status, 201);

    player1Id = p1.data._id;
    player2Id = p2.data._id;
    player3Id = p3.data._id;
    player4Id = p4.data._id;

    // Create training session on matchDate
    const sessRes = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        title: `Training_${testSuffix}`,
        sport: 'Football',
        date: matchDate,
        time: '09:00',
        venue: 'Main Ground',
        attendance: [
          { player: player1Id, status: 'present', participation: 'both' },
          { player: player2Id, status: 'present', participation: 'both' },
          { player: player3Id, status: 'present', participation: 'both' },
          { player: player4Id, status: 'absent', participation: 'both' }
        ]
      })
    });
    assert.equal(sessRes.status, 201);

    // Save session attendance with P1, P2, P3 present and P4 absent
    const saveSessRes = await api(`/api/sessions/${sessRes.data._id}/save`, {
      method: 'PATCH',
      body: JSON.stringify({
        attendance: [
          { playerId: player1Id, status: 'present', participation: 'both' },
          { playerId: player2Id, status: 'present', participation: 'both' },
          { playerId: player3Id, status: 'present', participation: 'both' },
          { playerId: player4Id, status: 'absent', participation: 'both' }
        ]
      })
    });
    assert.equal(saveSessRes.status, 200);
  });

  // Step 2: Match Creation with variable Maximum Squad Size
  await t.test('2. Match Creation with variable maxSquadSize', async () => {
    const createRes = await api('/api/matches', {
      method: 'POST',
      body: JSON.stringify({
        title: `League Match ${testSuffix}`,
        sport: 'Football',
        date: matchDate,
        time: matchKickoff,
        opponent: `Rival FC ${testSuffix}`,
        venue: 'City Arena',
        description: 'Championship semi-final',
        maxSquadSize: 2 // Configured variable squad size: maximum 2 players!
      })
    });

    assert.equal(createRes.status, 201, 'Match created successfully');
    assert.equal(createRes.data.status, 'upcoming', 'Initial status is upcoming');
    assert.equal(createRes.data.maxSquadSize, 2, 'maxSquadSize is saved as 2');
    testMatchId = createRes.data._id;

    // Verify it appears in upcoming matches
    const upcomingRes = await api('/api/matches?status=upcoming');
    assert.equal(upcomingRes.status, 200);
    const found = (upcomingRes.data.matches || upcomingRes.data).find(m => m._id === testMatchId);
    assert.ok(found, 'Match must appear in Upcoming Matches');
    assert.equal(found.maxSquadSize, 2);
  });

  // Step 3: Eligibility & Max Squad Size Enforcement
  await t.test('3. Eligibility check & maxSquadSize enforcement', async () => {
    const eligRes = await api(`/api/matches/${testMatchId}/eligible-players`);
    assert.equal(eligRes.status, 200);
    assert.equal(eligRes.data.sessionFound, true);

    const eligibleIds = eligRes.data.players.map(p => p.playerId);
    assert.ok(eligibleIds.includes(player1Id), 'Present player 1 is eligible');
    assert.ok(eligibleIds.includes(player2Id), 'Present player 2 is eligible');
    assert.ok(eligibleIds.includes(player3Id), 'Present player 3 is eligible');
    assert.ok(!eligibleIds.includes(player4Id), 'Absent player 4 must NOT be eligible');

    // Attempting to select 3 players when maxSquadSize is 2 must be rejected
    const overLimitRes = await api(`/api/matches/${testMatchId}/selected-players`, {
      method: 'PUT',
      body: JSON.stringify({ playerIds: [player1Id, player2Id, player3Id] })
    });
    assert.equal(overLimitRes.status, 400, 'Selecting more than maxSquadSize must return 400');

    // Selecting 2 eligible players must succeed
    const validSelectRes = await api(`/api/matches/${testMatchId}/selected-players`, {
      method: 'PUT',
      body: JSON.stringify({ playerIds: [player1Id, player2Id] })
    });
    assert.equal(validSelectRes.status, 200, 'Selecting within maxSquadSize must succeed');
  });

  // Step 4: Before 60-Minute Unlock (Kickoff is 14:00, simulate 14:30)
  await t.test('4. At 14:30 (30 mins into match) — Scoring is Locked', async () => {
    const mockNow = `${matchDate}T14:30:00`;
    // Attempting to record participation/scores via save-all or patch before unlock must be rejected with 403
    const earlySaveRes = await api(`/api/matches/${testMatchId}/save-all`, {
      method: 'POST',
      headers: { 'x-mock-now': mockNow },
      body: JSON.stringify({
        selectedPlayerIds: [player1Id, player2Id],
        participations: [
          { playerId: player1Id, played: true, score: 2 }
        ],
        complete: false
      })
    });
    assert.equal(earlySaveRes.status, 403, 'Early scoring must return 403 locked');
    assert.equal(earlySaveRes.data.locked, true);
  });

  // Step 5: After 60-Minute Unlock (Simulate 15:00 = Kickoff + 60 mins) — Save Draft
  await t.test('5. At 15:00 — Scoring Unlocked: Coach saves Draft', async () => {
    const mockNow = `${matchDate}T15:00:00`;
    const draftRes = await api(`/api/matches/${testMatchId}/save-all`, {
      method: 'POST',
      headers: { 'x-mock-now': mockNow },
      body: JSON.stringify({
        selectedPlayerIds: [player1Id, player2Id],
        participations: [
          { playerId: player1Id, played: true, score: 3, remarks: 'Hat-trick hero' },
          { playerId: player2Id, played: false, score: null, remarks: 'Benched' }
        ],
        complete: false // Draft only
      })
    });

    assert.equal(draftRes.status, 200, 'Draft save must succeed');
    assert.equal(draftRes.data.match.status, 'upcoming', 'Match remains upcoming when draft saved');

    // Verify participation in database
    const partRes = await api(`/api/matches/${testMatchId}/participation`);
    assert.equal(partRes.status, 200);
    const p1Part = partRes.data.participations.find(p => p.playerId === player1Id);
    const p2Part = partRes.data.participations.find(p => p.playerId === player2Id);
    assert.equal(p1Part.played, true);
    assert.equal(p1Part.score, 3);
    assert.equal(p2Part.played, false);
    assert.equal(p2Part.score, null);
  });

  // Step 6: Save & Complete Match
  await t.test('6. Save & Complete Match via unified action', async () => {
    const mockNow = `${matchDate}T15:05:00`;
    const completeRes = await api(`/api/matches/${testMatchId}/save-all`, {
      method: 'POST',
      headers: { 'x-mock-now': mockNow },
      body: JSON.stringify({
        selectedPlayerIds: [player1Id, player2Id],
        participations: [
          { playerId: player1Id, played: true, score: 3, remarks: 'Hat-trick hero' },
          { playerId: player2Id, played: false, score: null, remarks: 'Benched' }
        ],
        complete: true
      })
    });

    assert.equal(completeRes.status, 200, 'Save and complete must succeed');
    assert.equal(completeRes.data.match.status, 'completed', 'Match status becomes completed');
  });

  // Step 7: Completed Matches display & Permanent Persistence
  await t.test('7. Completed Matches display & scores permanence after page refresh', async () => {
    const completedListRes = await api('/api/matches?status=completed');
    assert.equal(completedListRes.status, 200);
    const completedMatch = (completedListRes.data.matches || completedListRes.data).find(m => m._id === testMatchId);
    assert.ok(completedMatch, 'Match must be present in completed list');

    // Verify scores are returned
    const p1Part = completedMatch.participations.find(p => (p.player?._id || p.player || p.playerId) === player1Id);
    const p2Part = completedMatch.participations.find(p => (p.player?._id || p.player || p.playerId) === player2Id);
    assert.ok(p1Part, 'P1 participation must be returned');
    assert.equal(p1Part.played, true);
    assert.equal(p1Part.score, 3);
    assert.ok(p2Part, 'P2 participation must be returned');
    assert.equal(p2Part.played, false);

    // Verify player stats: P1 (played=true) matchesPlayed incremented; P2 (played=false) matchesPlayed NOT incremented
    const p1Doc = await api(`/api/players/${player1Id}`);
    const p2Doc = await api(`/api/players/${player2Id}`);
    assert.equal(p1Doc.data.matchesPlayed, 1, 'Player 1 who played must have matchesPlayed = 1');
    assert.equal(p2Doc.data.matchesPlayed, 0, 'Player 2 who did not play must have matchesPlayed = 0');
  });

  // Step 8: Cleanup test artifacts to keep the database pristine
  await t.test('8. Cleanup test entities', async () => {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    const Player = require('../src/models/Player');
    const Match = require('../src/models/Match');
    const Session = require('../src/models/Session');
    const MatchParticipation = require('../src/models/MatchParticipation');

    const ids = [player1Id, player2Id, player3Id, player4Id].filter(Boolean);
    await MatchParticipation.deleteMany({ player: { $in: ids } });
    if (testMatchId) await Match.deleteOne({ _id: testMatchId });
    await Session.deleteMany({ 'attendance.player': { $in: ids } });
    await Player.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  });
});
