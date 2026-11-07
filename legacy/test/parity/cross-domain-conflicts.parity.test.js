// test/parity/cross-domain-conflicts.parity.test.js
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

test('PARITY - Conflict: Completed match then marking player absent triggers conflict, drops readiness, preserves scores; back to present clears conflict', async () => {
  const { coach, token } = await createCoachFixture('conflict_flow');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const testPlayer = players[0];
  const testPlayerId = testPlayer._id.toString();
  const date = getPastDateStr(2);

  // 1. Session 1 on date (Saved with all 12 present)
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

  // 2. Create and complete Match on same date where testPlayer participates
  const matchRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Derby Clash',
      sport: 'Football',
      date,
      time: '18:00',
      opponent: 'City Stars',
      venue: 'Arena Main'
    })
  });
  const match = await matchRes.json();
  const squad = players.slice(0, 11);

  await fetch(`${baseUrl}/api/matches/${match._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map((p, idx) => ({
        playerId: p._id.toString(),
        played: true,
        score: idx === 0 ? 5 : 1
      }))
    })
  });

  await fetch(`${baseUrl}/api/matches/${match._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ scoreTeam: 5, scoreOpponent: 1 })
  });

  // 3. Check player before conflict: matchesPlayed = 1, conflictedMatchesCount = 0
  const p1Res = await fetch(`${baseUrl}/api/players/${testPlayerId}`, { headers: authHeader(token) });
  const p1 = await p1Res.json();
  assert.equal(p1.matchesPlayed, 1);
  assert.equal(p1.conflictedMatchesCount, 0);

  // 4. Unlock session and mark testPlayer ABSENT on that date
  await fetch(`${baseUrl}/api/sessions/${session._id}/unlock`, { method: 'PATCH', headers: authHeader(token) });
  const saveAbsentRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map(p => ({
        player: p._id.toString(),
        status: p._id.toString() === testPlayerId ? 'absent' : 'present'
      }))
    })
  });
  assert.equal(saveAbsentRes.status, 200);

  // 5. Verify CONFLICT FLAGGED, valid matches drop from 1 to 0, readiness drops, historical score preserved
  const pConflictRes = await fetch(`${baseUrl}/api/players/${testPlayerId}`, { headers: authHeader(token) });
  const pConflict = await pConflictRes.json();
  assert.equal(pConflict.conflictedMatchesCount, 1, 'Player must have conflictedMatchesCount = 1');
  assert.equal(pConflict.matchesPlayed, 0, 'Valid matches played must drop from 1 to 0');
  assert.equal(pConflict.isReady, false, 'Readiness must drop when conflict exists');

  // Verify historical score (5) is preserved in DB
  const part = await MatchParticipation.findOne({ match: match._id, player: testPlayer._id });
  assert.ok(part, 'Participation record must be preserved');
  assert.equal(part.score, 5, 'Score of 5 must be preserved in MongoDB');
  assert.equal(part.attendanceConflict, true, 'attendanceConflict on participation must be true');

  // 6. Unlock session and change player back to PRESENT
  await fetch(`${baseUrl}/api/sessions/${session._id}/unlock`, { method: 'PATCH', headers: authHeader(token) });
  const savePresentRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map(p => ({ player: p._id.toString(), status: 'present' }))
    })
  });
  assert.equal(savePresentRes.status, 200);

  // 7. Verify conflict CLEARS automatically and zero duplicate records created
  const pResolvedRes = await fetch(`${baseUrl}/api/players/${testPlayerId}`, { headers: authHeader(token) });
  const pResolved = await pResolvedRes.json();
  assert.equal(pResolved.conflictedMatchesCount, 0, 'Conflict count must clear to 0');
  assert.equal(pResolved.matchesPlayed, 1, 'Valid matches played must be restored to 1');

  const partCount = await MatchParticipation.countDocuments({ match: match._id, player: testPlayer._id });
  assert.equal(partCount, 1, 'Exactly one MatchParticipation record must exist (no duplicates)');
});
