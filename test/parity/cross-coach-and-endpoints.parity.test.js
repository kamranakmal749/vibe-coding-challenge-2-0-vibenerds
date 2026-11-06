// test/parity/cross-coach-and-endpoints.parity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  startTestServer,
  stopTestServer,
  authHeader,
  getPastDateStr,
  createCoachFixture,
  createPlayerTeamFixture,
  MatchParticipation
} = require('./parity-helpers');

let baseUrl;

test.before(async () => {
  baseUrl = await startTestServer();
});

test.after(async () => {
  await stopTestServer();
});

test('PARITY - Cross-Coach: Strict 403 isolation across sessions, players, and matches', async () => {
  const { coach: coachA, token: tokenA } = await createCoachFixture('isolation_coachA');
  const { coach: coachB, token: tokenB } = await createCoachFixture('isolation_coachB');

  const playersA = await createPlayerTeamFixture(coachA._id, 'Football', 12);
  const pA = playersA[0];
  const date = getPastDateStr(4);

  // 1. Session created by Coach A
  const sRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const sessionA = await sRes.json();

  // Coach B cannot GET Coach A's session
  const getSessRes = await fetch(`${baseUrl}/api/sessions/${sessionA._id}`, { headers: authHeader(tokenB) });
  assert.equal(getSessRes.status, 403, 'Coach B must get 403 on GET Coach A session');

  // Coach B cannot PATCH /mark Coach A's session
  const markSessRes = await fetch(`${baseUrl}/api/sessions/${sessionA._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ playerId: pA._id.toString(), status: 'absent' })
  });
  assert.equal(markSessRes.status, 403, 'Coach B must get 403 on PATCH /mark Coach A session');

  // Coach B cannot PATCH /save Coach A's session
  const saveSessRes = await fetch(`${baseUrl}/api/sessions/${sessionA._id}/save`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ attendance: [{ player: pA._id.toString(), status: 'present' }] })
  });
  assert.equal(saveSessRes.status, 403, 'Coach B must get 403 on PATCH /save Coach A session');

  // Coach A saves the session so we can test unlock
  await fetch(`${baseUrl}/api/sessions/${sessionA._id}/save`, {
    method: 'PATCH',
    headers: authHeader(tokenA),
    body: JSON.stringify({ attendance: playersA.map(p => ({ player: p._id.toString(), status: 'present' })) })
  });

  // Coach B cannot PATCH /unlock Coach A's session
  const unlockSessRes = await fetch(`${baseUrl}/api/sessions/${sessionA._id}/unlock`, {
    method: 'PATCH',
    headers: authHeader(tokenB)
  });
  assert.equal(unlockSessRes.status, 403, 'Coach B must get 403 on PATCH /unlock Coach A session');

  // 2. Player owned by Coach A
  // Coach B cannot PUT Coach A's player
  const putPlayerRes = await fetch(`${baseUrl}/api/players/${pA._id}`, {
    method: 'PUT',
    headers: authHeader(tokenB),
    body: JSON.stringify({ name: 'Tampered Name', age: 16, sport: 'Football' })
  });
  assert.equal(putPlayerRes.status, 403, 'Coach B must get 403 on PUT Coach A player');

  // Coach B cannot PATCH Coach A's player
  const patchPlayerRes = await fetch(`${baseUrl}/api/players/${pA._id}`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ name: 'Tampered Name' })
  });
  assert.equal(patchPlayerRes.status, 403, 'Coach B must get 403 on PATCH Coach A player');

  // 3. Match created by Coach A
  const mRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(tokenA),
    body: JSON.stringify({
      title: 'Coach A Match',
      sport: 'Football',
      date,
      time: '16:00',
      opponent: 'Opponent FC',
      venue: 'Arena A'
    })
  });
  const matchA = await mRes.json();

  // Coach B cannot GET Coach A's match
  const getMatchRes = await fetch(`${baseUrl}/api/matches/${matchA._id}`, { headers: authHeader(tokenB) });
  assert.equal(getMatchRes.status, 403, 'Coach B must get 403 on GET Coach A match');

  // Coach B cannot PATCH Coach A's match
  const patchMatchRes = await fetch(`${baseUrl}/api/matches/${matchA._id}`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ title: 'Hijacked Match' })
  });
  assert.equal(patchMatchRes.status, 403, 'Coach B must get 403 on PATCH Coach A match');

  // Coach B cannot PUT /selected-players Coach A's match
  const selPlayersRes = await fetch(`${baseUrl}/api/matches/${matchA._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(tokenB),
    body: JSON.stringify({ selectedPlayerIds: playersA.slice(0, 11).map(p => p._id.toString()) })
  });
  assert.equal(selPlayersRes.status, 403, 'Coach B must get 403 on PUT /selected-players Coach A match');

  // Coach B cannot POST /save-all Coach A's match
  const saveAllRes = await fetch(`${baseUrl}/api/matches/${matchA._id}/save-all`, {
    method: 'POST',
    headers: authHeader(tokenB),
    body: JSON.stringify({
      selectedPlayerIds: playersA.slice(0, 11).map(p => p._id.toString()),
      participations: playersA.slice(0, 11).map(p => ({ playerId: p._id.toString(), played: true, score: 1 }))
    })
  });
  assert.equal(saveAllRes.status, 403, 'Coach B must get 403 on POST /save-all Coach A match');

  // Coach B cannot PATCH /complete Coach A's match
  const completeRes = await fetch(`${baseUrl}/api/matches/${matchA._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(tokenB),
    body: JSON.stringify({ scoreTeam: 1, scoreOpponent: 0 })
  });
  assert.equal(completeRes.status, 403, 'Coach B must get 403 on PATCH /complete Coach A match');
});

test('PARITY - Lifecycle: Match cancellation and deletion effects on Ready status', async () => {
  const { coach, token } = await createCoachFixture('cancel_ready_check');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const p1 = players[0];
  const d1 = getPastDateStr(3);
  const d2 = getPastDateStr(2);
  const d3 = getPastDateStr(1);

  // 3 sessions with 100% attendance
  for (const d of [d1, d2, d3]) {
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

  const squad = players.slice(0, 11);

  // Complete Match 1
  const m1Res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: 'M1', sport: 'Football', date: d1, time: '17:00', opponent: 'Opp 1', venue: 'V' })
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

  // Complete Match 2
  const m2Res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: 'M2', sport: 'Football', date: d2, time: '17:00', opponent: 'Opp 2', venue: 'V' })
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
    body: JSON.stringify({ scoreTeam: 1, scoreOpponent: 0 })
  });

  // Verify p1 is READY (2 matches, 100% att)
  const pBeforeRes = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
  const pBefore = await pBeforeRes.json();
  assert.equal(pBefore.matchesPlayed, 2);
  assert.equal(pBefore.isReady, true);

  // 1. Attempting to cancel a completed match returns 409
  const badCancelRes = await fetch(`${baseUrl}/api/matches/${m2._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ reason: 'Try cancel completed' })
  });
  assert.equal(badCancelRes.status, 409, 'Cancelling completed match must return 409');

  // 2. Upcoming match cancellation works and cannot be completed
  const m3Res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: 'M3 Upcoming', sport: 'Football', date: d3, time: '18:00', opponent: 'Opp 3', venue: 'V' })
  });
  const m3 = await m3Res.json();
  const cancelUpcomingRes = await fetch(`${baseUrl}/api/matches/${m3._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ reason: 'Weather postponement' })
  });
  assert.equal(cancelUpcomingRes.status, 200, 'Upcoming match cancellation must return 200');
  const cancelledMatch = await cancelUpcomingRes.json();
  assert.equal(cancelledMatch.match.status, 'cancelled');

  // Attempting to complete a cancelled match returns 409
  const completeCancelledRes = await fetch(`${baseUrl}/api/matches/${m3._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ scoreTeam: 1, scoreOpponent: 0 })
  });
  assert.equal(completeCancelledRes.status, 409, 'Completing a cancelled match must return 409');

  // 3. Deleting completed Match 2 permanently drops matchesPlayed from 2 to 1 and revokes isReady
  const deleteM2Res = await fetch(`${baseUrl}/api/matches/${m2._id}`, {
    method: 'DELETE',
    headers: authHeader(token)
  });
  assert.equal(deleteM2Res.status, 200);

  const pAfterRes = await fetch(`${baseUrl}/api/players/${p1._id}`, { headers: authHeader(token) });
  const pAfter = await pAfterRes.json();
  assert.equal(pAfter.matchesPlayed, 1, 'Valid matches played must drop to 1 after match deletion');
  assert.equal(pAfter.isReady, false, 'Readiness must be revoked when valid completed matches < 2');
});

test('PARITY - Match: PUT /api/matches/:id/entries behavior (409 without session, 422 if absent, 200 valid)', async () => {
  const { coach, token } = await createCoachFixture('entries_behavior');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const pAbsent = players[0];
  const pPresent = players[1];

  // Use completely isolated date far in the past to avoid colliding with any session
  const dateNoSession = getPastDateStr(25);
  const dateWithSession = getPastDateStr(26);

  // Create match on dateNoSession directly via DB model to test PUT /entries without session
  const Match = require('../../src/models/Match');
  const standaloneMatch = await Match.create({
    title: 'Standalone Match',
    sport: 'Football',
    coach: coach._id,
    date: new Date(dateNoSession),
    time: '14:00',
    opponent: 'Opponent FC',
    venue: 'Ground X',
    status: 'upcoming'
  });

  // 1. PUT entries when no session exists on date -> returns 409
  const noSessionEntriesRes = await fetch(`${baseUrl}/api/matches/${standaloneMatch._id}/entries`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({
      entries: [{ playerId: pPresent._id.toString(), result: 'played', goals: 1 }]
    })
  });
  assert.equal(noSessionEntriesRes.status, 409, 'Must return 409 when no saved session exists for match date');
  const noSessionJson = await noSessionEntriesRes.json();
  assert.ok(noSessionJson.error.includes('Save attendance for this date'));

  // 2. Create session and match on dateWithSession: pAbsent is absent, remaining 11 are present
  const sRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date: dateWithSession, sport: 'Football' })
  });
  const session = await sRes.json();
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map(p => ({
        player: p._id.toString(),
        status: p._id.toString() === pAbsent._id.toString() ? 'absent' : 'present'
      }))
    })
  });

  const mRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Session Linked Match',
      sport: 'Football',
      date: dateWithSession,
      time: '14:00',
      opponent: 'Opponent FC',
      venue: 'Ground Y'
    })
  });
  const matchWithSession = await mRes.json();

  // PUT entries with absent player -> returns 422
  const absentEntriesRes = await fetch(`${baseUrl}/api/matches/${matchWithSession._id}/entries`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({
      entries: [
        { playerId: pAbsent._id.toString(), result: 'played', goals: 1 },
        { playerId: pPresent._id.toString(), result: 'played', goals: 1 }
      ]
    })
  });
  assert.equal(absentEntriesRes.status, 422, 'Must return 422 when entries include absent player');
  const absentJson = await absentEntriesRes.json();
  assert.equal(absentJson.error, 'Absent on this date');

  // 3. PUT partial entries (missing eligible players) -> returns 422
  const partialEntriesRes = await fetch(`${baseUrl}/api/matches/${matchWithSession._id}/entries`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({
      entries: [
        { playerId: pPresent._id.toString(), result: 'played', score: 2 }
      ]
    })
  });
  assert.equal(partialEntriesRes.status, 422, 'Must return 422 when eligible players are missing from entries');
  const partialJson = await partialEntriesRes.json();
  assert.equal(partialJson.error, 'Needs a score or Did not play');

  // 4. PUT complete entries for all 11 present players -> returns 200
  const presentPlayers = players.filter(p => p._id.toString() !== pAbsent._id.toString());
  const validEntriesRes = await fetch(`${baseUrl}/api/matches/${matchWithSession._id}/entries`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({
      entries: presentPlayers.map((p, idx) => ({
        playerId: p._id.toString(),
        result: idx === 0 ? 'played' : 'did_not_play',
        score: idx === 0 ? 2 : null
      }))
    })
  });
  assert.equal(validEntriesRes.status, 200, 'Must return 200 on valid complete entries');
  const validJson = await validEntriesRes.json();
  assert.equal(validJson.message, 'Match entries saved successfully');
});

test('PARITY - Match: Response shapes for /check-eligibility, /history, and /calendar', async () => {
  const { coach, token } = await createCoachFixture('shapes_coach');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(2);

  // 1. Session and Match creation
  const sRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const session = await sRes.json();
  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ attendance: players.map(p => ({ player: p._id.toString(), status: 'present' })) })
  });

  const mRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ title: 'Shape Test Match', sport: 'Football', date, time: '18:00', opponent: 'City Stars', venue: 'Grand Field' })
  });
  const match = await mRes.json();

  // Complete match so it appears in /history
  const squad = players.slice(0, 11);
  await fetch(`${baseUrl}/api/matches/${match._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map(p => ({ playerId: p._id.toString(), played: true, score: 3 }))
    })
  });
  await fetch(`${baseUrl}/api/matches/${match._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ scoreTeam: 3, scoreOpponent: 1 })
  });

  // 2. GET /api/matches/check-eligibility shape check
  const eligRes = await fetch(`${baseUrl}/api/matches/check-eligibility?sport=Football&date=${date}`, {
    headers: authHeader(token)
  });
  assert.equal(eligRes.status, 200);
  const elig = await eligRes.json();
  assert.equal(elig.sessionFinalized, true);
  assert.equal(elig.sport, 'Football');
  assert.equal(elig.date, date);
  assert.equal(typeof elig.minTeamSize, 'number');
  assert.equal(typeof elig.totalEligible, 'number');
  assert.equal(typeof elig.isBlocked, 'boolean');
  assert.ok(Array.isArray(elig.players));
  if (elig.players.length > 0) {
    assert.ok(elig.players[0].playerId);
    assert.ok(elig.players[0].name);
  }

  // 3. GET /api/matches/history shape check
  const histRes = await fetch(`${baseUrl}/api/matches/history?sport=Football`, {
    headers: authHeader(token)
  });
  assert.equal(histRes.status, 200);
  const hist = await histRes.json();
  assert.ok(Array.isArray(hist));
  const foundMatch = hist.find(m => (m._id || m.id) === match._id);
  assert.ok(foundMatch, 'Completed match must be in history');
  assert.equal(foundMatch.status, 'completed');
  assert.equal(typeof foundMatch.totalPlayed, 'number');
  assert.ok(Array.isArray(foundMatch.participations));

  // 4. GET /api/matches/calendar shape check
  const monthStr = date.slice(0, 7); // 'YYYY-MM'
  const calRes = await fetch(`${baseUrl}/api/matches/calendar?month=${monthStr}`, {
    headers: authHeader(token)
  });
  assert.equal(calRes.status, 200);
  const cal = await calRes.json();
  assert.ok(Array.isArray(cal));
});
