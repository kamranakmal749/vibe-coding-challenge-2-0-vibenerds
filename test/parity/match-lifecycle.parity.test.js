// test/parity/match-lifecycle.parity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  startTestServer,
  stopTestServer,
  authHeader,
  getPastDateStr,
  createCoachFixture,
  createPlayerTeamFixture
} = require('./parity-helpers');

let baseUrl;

test.before(async () => {
  baseUrl = await startTestServer();
});

test.after(async () => {
  await stopTestServer();
});

test('PARITY - Match: 11-player minimum rule enforced for Football matches', async () => {
  const { coach, token } = await createCoachFixture('match_min_rule');
  const dateBad = getPastDateStr(3);
  const dateGood = getPastDateStr(2);

  // 1. Session exists on dateBad with only 5 present players: match creation must fail with 400
  const players5 = await createPlayerTeamFixture(coach._id, 'Football', 5);
  const sessRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date: dateBad, sport: 'Football' })
  });
  const session = await sessRes.json();
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ attendance: players5.map(p => ({ player: p._id.toString(), status: 'present' })) })
  });

  const badRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Derby Cup Clash',
      sport: 'Football',
      date: dateBad,
      time: '16:00',
      opponent: 'Titans FC',
      venue: 'City Arena'
    })
  });
  assert.equal(badRes.status, 400);
  const badJson = await badRes.json();
  assert.ok(badJson.error.toLowerCase().includes('requires at least 11'));

  // 2. Add 7 more players and record all 12 present in session on dateGood: match creation succeeds (201)
  const playersMore = await createPlayerTeamFixture(coach._id, 'Football', 7);
  const all12 = [...players5, ...playersMore];
  const sessGoodRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date: dateGood, sport: 'Football' })
  });
  const sessionGood = await sessGoodRes.json();
  await fetch(`${baseUrl}/api/sessions/${sessionGood._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ attendance: all12.map(p => ({ player: p._id.toString(), status: 'present' })) })
  });

  const okRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Derby Cup Clash',
      sport: 'Football',
      date: dateGood,
      time: '16:00',
      opponent: 'Titans FC',
      venue: 'City Arena'
    })
  });
  assert.equal(okRes.status, 201);
  const match = await okRes.json();
  assert.equal(match.status, 'upcoming');
  assert.equal(match.sport, 'Football');
});

test('PARITY - Match: Eligible players derived from same-day attendance; absent player refused', async () => {
  const { coach, token } = await createCoachFixture('match_elig');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(3);

  // 1. Create same-day attendance session: 11 present, 1 absent (players[0] absent)
  const openRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const session = await openRes.json();
  const absentPlayerId = players[0]._id.toString();

  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map((p, idx) => ({
        player: p._id.toString(),
        status: idx === 0 ? 'absent' : 'present'
      }))
    })
  });

  // 2. Create match on same date
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'League Match Day 1',
      sport: 'Football',
      date,
      time: '17:00',
      opponent: 'Rovers FC',
      venue: 'Ground A'
    })
  });
  assert.equal(matchRes.status, 201);
  const match = await matchRes.json();

  // 3. GET /api/matches/:id/eligible-players: absent player must NOT be in eligible list
  const eligRes = await fetch(`${baseUrl}/api/matches/${match._id}/eligible-players`, {
    headers: authHeader(token)
  });
  assert.equal(eligRes.status, 200);
  const eligData = await eligRes.json();
  const eligIds = eligData.players.map(p => (p._id || p).toString());
  assert.equal(eligIds.includes(absentPlayerId), false, 'Absent player must not be eligible');
  assert.equal(eligIds.length, 11, 'All 11 present players must be eligible');

  // 4. PUT /api/matches/:id/selected-players including the absent player must return 400 or 422
  const badSquadRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: [absentPlayerId, ...eligIds.slice(0, 10)]
    })
  });
  assert.ok([400, 422].includes(badSquadRes.status), 'Absent player in squad selection must be rejected');
});

test('PARITY - Match: Save squad, record scores via /save-all and complete match via /complete', async () => {
  const { coach, token } = await createCoachFixture('match_save_complete');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(4);

  // Create session with all 12 present & saved
  const sessRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const session = await sessRes.json();
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map(p => ({ player: p._id.toString(), status: 'present' }))
    })
  });

  // Create match
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Championship Final',
      sport: 'Football',
      date,
      time: '18:00',
      opponent: 'Eagles FC',
      venue: 'National Arena'
    })
  });
  const match = await matchRes.json();

  // Save all (11 players in squad with valid scores 0-20)
  const squad = players.slice(0, 11);
  const saveAllRes = await fetch(`${baseUrl}/api/matches/${match._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map((p, idx) => ({
        playerId: p._id.toString(),
        played: true,
        score: idx === 0 ? 3 : 1
      }))
    })
  });
  assert.equal(saveAllRes.status, 200);

  // Complete match
  const compRes = await fetch(`${baseUrl}/api/matches/${match._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      scoreTeam: 3,
      scoreOpponent: 1
    })
  });
  assert.equal(compRes.status, 200);
  const completed = await compRes.json();
  assert.equal(completed.match.status, 'completed');
});
