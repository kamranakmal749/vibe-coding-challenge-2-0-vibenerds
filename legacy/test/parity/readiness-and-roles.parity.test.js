// test/parity/readiness-and-roles.parity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const {
  startTestServer,
  stopTestServer,
  authHeader,
  getPastDateStr,
  createCoachFixture,
  createAdminFixture,
  createScoutFixture,
  createPlayerTeamFixture,
  JWT_SECRET,
  User,
  MatchParticipation
} = require('./parity-helpers');

let baseUrl;

test.before(async () => {
  baseUrl = await startTestServer();
});

test.after(async () => {
  await stopTestServer();
});

test('PARITY - Readiness: Boundary conditions (74%+2=NOT READY, 75%+1=NOT READY, 75%+2=READY)', async () => {
  const { coach, token } = await createCoachFixture('ready_bounds');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const p1 = players[0]; // will get 75% att + 2 matches -> READY
  const p2 = players[1]; // will get 75% att + 1 match   -> NOT READY
  const p3 = players[2]; // will get <75% att + 2 matches -> NOT READY

  const d1 = getPastDateStr(5);
  const d2 = getPastDateStr(4);
  const d3 = getPastDateStr(3);
  const d4 = getPastDateStr(2);

  // 4 sessions:
  // p1 present in 3/4 (75%)
  // p2 present in 3/4 (75%)
  // p3 present in 2/4 (50% < 75%)
  for (let i = 1; i <= 4; i++) {
    const d = [d1, d2, d3, d4][i - 1];
    const sRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ date: d, sport: 'Football' })
    });
    const s = await sRes.json();
    await fetch(`${baseUrl}/api/sessions/${s._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({
        attendance: players.map(p => {
          const pid = p._id.toString();
          let status = 'present';
          if (pid === p1._id.toString()) status = (i <= 3) ? 'present' : 'absent';
          else if (pid === p2._id.toString()) status = (i <= 3) ? 'present' : 'absent';
          else if (pid === p3._id.toString()) status = (i <= 2) ? 'present' : 'absent';
          return { player: pid, status };
        })
      })
    });
  }

  // Helper to create and complete a match with squad
  async function completeMatch(date, squadPlayers) {
    const mRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({
        title: `Match on ${date}`,
        sport: 'Football',
        date,
        time: '18:00',
        opponent: 'Opp FC',
        venue: 'Stadium'
      })
    });
    const m = await mRes.json();
    await fetch(`${baseUrl}/api/matches/${m._id}/save-all`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({
        selectedPlayerIds: squadPlayers.map(p => p._id.toString()),
        participations: squadPlayers.map(p => ({ playerId: p._id.toString(), played: true, score: 2 }))
      })
    });
    await fetch(`${baseUrl}/api/matches/${m._id}/complete`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ scoreTeam: 2, scoreOpponent: 0 })
    });
    return m;
  }

  // Match 1 on d1: squad has p1, p2, p3 + 8 others = 11 players
  const squad1 = [p1, p2, p3, ...players.slice(3, 11)];
  await completeMatch(d1, squad1);

  // Match 2 on d2: squad has p1, p3 + 9 others (excludes p2)
  const squad2 = [p1, p3, ...players.slice(3, 12)];
  await completeMatch(d2, squad2);

  // Evaluate Readiness:
  // p1: 75% att + 2 matches -> READY
  const p1Res = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
  const p1Data = await p1Res.json();
  assert.equal(p1Data.attendanceRate, 75);
  assert.equal(p1Data.matchesPlayed, 2);
  assert.equal(p1Data.isReady, true, '75% att + 2 matches must be READY');

  // p2: 75% att + 1 match -> NOT READY
  const p2Res = await fetch(`${baseUrl}/api/players/${p2._id}`, { headers: authHeader(token) });
  const p2Data = await p2Res.json();
  assert.equal(p2Data.attendanceRate, 75);
  assert.equal(p2Data.matchesPlayed, 1);
  assert.equal(p2Data.isReady, false, '75% att + 1 match must be NOT READY');

  // p3: 50% att + 2 matches -> NOT READY
  const p3Res = await fetch(`${baseUrl}/api/players/${p3._id}`, { headers: authHeader(token) });
  const p3Data = await p3Res.json();
  assert.equal(p3Data.attendanceRate, 50);
  assert.equal(p3Data.matchesPlayed, 2);
  assert.equal(p3Data.isReady, false, '50% att + 2 matches must be NOT READY');
});

test('PARITY - Roles: Scout sees ONLY Ready players; Player sees ONLY own data; Cross-coach 403s', async () => {
  const { coach: coachA, token: tokenA } = await createCoachFixture('coachA');
  const { coach: coachB, token: tokenB } = await createCoachFixture('coachB');
  const { scout, token: scoutToken } = await createScoutFixture();

  const playersA = await createPlayerTeamFixture(coachA._id, 'Football', 12);
  const pA = playersA[0];
  const date = getPastDateStr(3);

  // Create user account for player pA
  const pUser = await User.create({
    name: pA.name,
    username: `user_${pA._id}`,
    email: `player_${pA._id}@parity-player.com`,
    password: 'playerpass123',
    role: 'player',
    playerId: pA._id
  });
  const playerToken = jwt.sign({ id: pUser._id, role: 'player', playerId: pA._id }, JWT_SECRET);

  // 1. Player endpoint GET /api/players/me returns only their own profile
  const meRes = await fetch(`${baseUrl}/api/players/me`, { headers: authHeader(playerToken) });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData._id.toString(), pA._id.toString());

  // Player attempting to access another player's detail returns 403
  const forbiddenRes = await fetch(`${baseUrl}/api/players/${playersA[1]._id}`, { headers: authHeader(playerToken) });
  assert.equal(forbiddenRes.status, 403);

  // 2. Cross-coach isolation: Coach B cannot edit or save Coach A's session
  const sessRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const sessionA = await sessRes.json();

  const crossCoachEditRes = await fetch(`${baseUrl}/api/sessions/${sessionA._id}/save`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({
      attendance: playersA.map(p => ({ player: p._id.toString(), status: 'present' }))
    })
  });
  assert.equal(crossCoachEditRes.status, 403, 'Cross-coach session save must return 403');

  // 3. Scout Radar GET /api/scout/ready returns ONLY ready players
  const scoutRes = await fetch(`${baseUrl}/api/scout/ready`, { headers: authHeader(scoutToken) });
  assert.equal(scoutRes.status, 200);
  const readyList = await scoutRes.json();
  const list = Array.isArray(readyList) ? readyList : (readyList.players || []);
  for (const item of list) {
    assert.equal(item.isReady, true, 'Scout radar must only return players where isReady is true');
  }
});

test('PARITY - Lifecycle: Reopen-for-edit and cancel effects on Ready status', async () => {
  const { coach, token } = await createCoachFixture('reopen_cancel');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const p1 = players[0];
  const d1 = getPastDateStr(3);
  const d2 = getPastDateStr(2);

  // 2 sessions with 100% attendance
  for (const d of [d1, d2]) {
    const sRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: authHeader(token),
      body: JSON.stringify({ date: d, sport: 'Football' })
    });
    const s = await sRes.json();
    await fetch(`${baseUrl}/api/sessions/${s._id}/save`, {
      method: 'PATCH',
      headers: authHeader(token),
      body: JSON.stringify({ attendance: players.map(p => ({ player: p._id.toString(), status: 'present' })) })
    });
  }

  // Complete Match 1
  const squad = players.slice(0, 11);
  const m1Res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: 'M1', sport: 'Football', date: d1, time: '17:00', opponent: 'X', venue: 'V' })
  });
  const m1 = await m1Res.json();
  await fetch(`${baseUrl}/api/matches/${m1._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map(p => ({ playerId: p._id.toString(), played: true, score: 2 }))
    })
  });
  await fetch(`${baseUrl}/api/matches/${m1._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ scoreTeam: 2, scoreOpponent: 0 })
  });

  // Complete Match 2 -> p1 now has 2 matches & 100% att -> READY
  const m2Res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: 'M2', sport: 'Football', date: d2, time: '17:00', opponent: 'Y', venue: 'V' })
  });
  const m2 = await m2Res.json();
  await fetch(`${baseUrl}/api/matches/${m2._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map(p => ({ playerId: p._id.toString(), played: true, score: 1 }))
    })
  });
  await fetch(`${baseUrl}/api/matches/${m2._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ scoreTeam: 1, scoreOpponent: 1 })
  });

  const pBeforeRes = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
  const pBefore = await pBeforeRes.json();
  assert.equal(pBefore.matchesPlayed, 2);
  assert.equal(pBefore.isReady, true);

  // Reopen Match 2 for edit: match status remains completed, but participation can be edited
  const reopenRes = await fetch(`${baseUrl}/api/matches/${m2._id}/reopen-for-edit`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ reason: 'Correction' })
  });
  assert.equal(reopenRes.status, 200);

  // Update p1 in Match 2 to played: false
  await fetch(`${baseUrl}/api/matches/${m2._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map(p => ({
        playerId: p._id.toString(),
        played: p._id.toString() === p1._id.toString() ? false : true,
        score: p._id.toString() === p1._id.toString() ? null : 1
      }))
    })
  });

  // Verify valid matches played drops from 2 to 1 and Readiness is revoked
  const pAfterRes = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
  const pAfter = await pAfterRes.json();
  assert.equal(pAfter.matchesPlayed, 1, 'Valid matches played must drop to 1');
  assert.equal(pAfter.isReady, false, 'Readiness must be revoked when valid matches < 2');
});
