// test/parity/sync-mutations.parity.test.js
// Parity test: Every mutation route must change /api/sync/version.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestServer,
  stopTestServer,
  authHeader,
  getPastDateStr,
  createCoachFixture,
  createAdminFixture,
  createPlayerTeamFixture
} = require('./parity-helpers');

let baseUrl;

test.before(async () => {
  baseUrl = await startTestServer();
});

test.after(async () => {
  await stopTestServer();
});

async function getSyncVersion() {
  const res = await fetch(`${baseUrl}/api/sync/version`);
  assert.equal(res.status, 200);
  const data = await res.json();
  return data.version;
}

test('PARITY - Sync: Every player mutation route changes /api/sync/version (POST, PUT, PATCH, DELETE)', async () => {
  const { coach, token } = await createCoachFixture('sync_player');
  const { admin, token: adminToken } = await createAdminFixture('sync_player_admin');

  // 1. POST /api/players
  const v1 = await getSyncVersion();
  await new Promise(r => setTimeout(r, 10));
  const createRes = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ name: 'Sync Player 1', age: 19, sport: 'Football' })
  });
  assert.equal(createRes.status, 201);
  const player = await createRes.json();
  const v2 = await getSyncVersion();
  assert.notEqual(v2, v1, 'POST /api/players must change sync version');

  // 2. PUT /api/players/:id
  await new Promise(r => setTimeout(r, 10));
  const putRes = await fetch(`${baseUrl}/api/players/${player._id}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ age: 20 })
  });
  assert.equal(putRes.status, 200);
  const v3 = await getSyncVersion();
  assert.notEqual(v3, v2, 'PUT /api/players/:id must change sync version');

  // 3. PATCH /api/players/:id
  await new Promise(r => setTimeout(r, 10));
  const patchRes = await fetch(`${baseUrl}/api/players/${player._id}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ age: 21 })
  });
  assert.equal(patchRes.status, 200);
  const v4 = await getSyncVersion();
  assert.notEqual(v4, v3, 'PATCH /api/players/:id must change sync version');

  // 4. DELETE /api/players/:id (admin only)
  await new Promise(r => setTimeout(r, 10));
  const delRes = await fetch(`${baseUrl}/api/players/${player._id}`, {
    method: 'DELETE',
    headers: authHeader(adminToken)
  });
  assert.equal(delRes.status, 200);
  const v5 = await getSyncVersion();
  assert.notEqual(v5, v4, 'DELETE /api/players/:id must change sync version');
});

test('PARITY - Sync: Every session mutation route changes /api/sync/version (POST, bulk, mark, save, unlock, toggle-lock, lock)', async () => {
  const { coach, token } = await createCoachFixture('sync_session');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date1 = getPastDateStr(3);
  const date2 = getPastDateStr(2);

  // 1. POST /api/sessions (Create draft session 1)
  const v1 = await getSyncVersion();
  await new Promise(r => setTimeout(r, 10));
  const sRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date: date1, sport: 'Football' })
  });
  assert.equal(sRes.status, 201);
  const session = await sRes.json();
  const v2 = await getSyncVersion();
  assert.notEqual(v2, v1, 'POST /api/sessions must change sync version');

  // 2. PATCH /api/sessions/:id/bulk (Draft bulk attendance update)
  await new Promise(r => setTimeout(r, 10));
  const bulkRes = await fetch(`${baseUrl}/api/sessions/${session._id}/bulk`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map(p => ({ playerId: p._id.toString(), status: 'present', participation: 'both' })),
      save: false
    })
  });
  assert.equal(bulkRes.status, 200);
  const v3 = await getSyncVersion();
  assert.notEqual(v3, v2, 'PATCH /api/sessions/:id/bulk must change sync version');

  // 3. PATCH /api/sessions/:id/mark (Single athlete status update)
  await new Promise(r => setTimeout(r, 10));
  const markRes = await fetch(`${baseUrl}/api/sessions/${session._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      playerId: players[0]._id.toString(),
      status: 'present',
      participation: 'practice'
    })
  });
  assert.equal(markRes.status, 200);
  const v4 = await getSyncVersion();
  assert.notEqual(v4, v3, 'PATCH /api/sessions/:id/mark must change sync version');

  // 4. PATCH /api/sessions/:id/save (Save - automatically locks)
  await new Promise(r => setTimeout(r, 10));
  const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: players.map(p => ({ player: p._id.toString(), status: 'present' }))
    })
  });
  assert.equal(saveRes.status, 200);
  const v5 = await getSyncVersion();
  assert.notEqual(v5, v4, 'PATCH /api/sessions/:id/save must change sync version');

  // 5. PATCH /api/sessions/:id/unlock (Unlock)
  await new Promise(r => setTimeout(r, 10));
  const unlockRes = await fetch(`${baseUrl}/api/sessions/${session._id}/unlock`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ reason: 'Correction needed' })
  });
  assert.equal(unlockRes.status, 200);
  const v6 = await getSyncVersion();
  assert.notEqual(v6, v5, 'PATCH /api/sessions/:id/unlock must change sync version');

  // 6. PATCH /api/sessions/:id/toggle-lock (Toggle Lock)
  await new Promise(r => setTimeout(r, 10));
  const toggleRes = await fetch(`${baseUrl}/api/sessions/${session._id}/toggle-lock`, {
    method: 'PATCH',
    headers: authHeader(token)
  });
  assert.equal(toggleRes.status, 200);
  const v7 = await getSyncVersion();
  assert.notEqual(v7, v6, 'PATCH /api/sessions/:id/toggle-lock must change sync version');

  // 7. PATCH /api/sessions/:id/lock (Lock unsaved draft session 2)
  const s2Res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date: date2, sport: 'Football' })
  });
  assert.equal(s2Res.status, 201);
  const session2 = await s2Res.json();
  const v8 = await getSyncVersion();

  await new Promise(r => setTimeout(r, 10));
  const lockRes = await fetch(`${baseUrl}/api/sessions/${session2._id}/lock`, {
    method: 'PATCH',
    headers: authHeader(token)
  });
  assert.equal(lockRes.status, 200);
  const v9 = await getSyncVersion();
  assert.notEqual(v9, v8, 'PATCH /api/sessions/:id/lock must change sync version');
});

test('PARITY - Sync: Every match mutation route changes /api/sync/version (POST, PATCH, selected-players, participation, save-all, complete, entries, reopen, edit-scores, cancel, DELETE)', async () => {
  const { coach, token } = await createCoachFixture('sync_match');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(2);

  // Pre-requisite session with 12 present players
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

  // 1. POST /api/matches (Create)
  const v1 = await getSyncVersion();
  await new Promise(r => setTimeout(r, 10));
  const mRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Sync Cup Match',
      sport: 'Football',
      date,
      time: '17:00',
      opponent: 'Rivals FC',
      venue: 'National Stadium'
    })
  });
  assert.equal(mRes.status, 201);
  const match = await mRes.json();
  const v2 = await getSyncVersion();
  assert.notEqual(v2, v1, 'POST /api/matches must change sync version');

  // 2. PATCH /api/matches/:id (Update match metadata)
  await new Promise(r => setTimeout(r, 10));
  const patchRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ venue: 'Main Arena' })
  });
  assert.equal(patchRes.status, 200);
  const v3 = await getSyncVersion();
  assert.notEqual(v3, v2, 'PATCH /api/matches/:id must change sync version');

  // 3. PUT /api/matches/:id/selected-players (Select squad)
  const squad = players.slice(0, 11);
  await new Promise(r => setTimeout(r, 10));
  const selRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ playerIds: squad.map(p => p._id.toString()) })
  });
  assert.equal(selRes.status, 200);
  const v4 = await getSyncVersion();
  assert.notEqual(v4, v3, 'PUT /api/matches/:id/selected-players must change sync version');

  // 4. PATCH /api/matches/:id/participation/:playerId (Individual participation update)
  await new Promise(r => setTimeout(r, 10));
  const partRes = await fetch(`${baseUrl}/api/matches/${match._id}/participation/${squad[0]._id}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ played: true, score: 2, remarks: 'Good start' })
  });
  assert.equal(partRes.status, 200);
  const v5 = await getSyncVersion();
  assert.notEqual(v5, v4, 'PATCH /api/matches/:id/participation/:playerId must change sync version');

  // 5. POST /api/matches/:id/save-all (Save participations)
  await new Promise(r => setTimeout(r, 10));
  const saveAllRes = await fetch(`${baseUrl}/api/matches/${match._id}/save-all`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      selectedPlayerIds: squad.map(p => p._id.toString()),
      participations: squad.map(p => ({ playerId: p._id.toString(), played: true, score: 3 }))
    })
  });
  assert.equal(saveAllRes.status, 200);
  const v6 = await getSyncVersion();
  assert.notEqual(v6, v5, 'POST /api/matches/:id/save-all must change sync version');

  // 6. PATCH /api/matches/:id/complete (Complete match)
  await new Promise(r => setTimeout(r, 10));
  const compRes = await fetch(`${baseUrl}/api/matches/${match._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ scoreTeam: 3, scoreOpponent: 1 })
  });
  assert.equal(compRes.status, 200);
  const v7 = await getSyncVersion();
  assert.notEqual(v7, v6, 'PATCH /api/matches/:id/complete must change sync version');

  // 7. PATCH /api/matches/:id/edit-scores (Edit scores on completed match)
  await new Promise(r => setTimeout(r, 10));
  const editScoreRes = await fetch(`${baseUrl}/api/matches/${match._id}/edit-scores`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      scores: [{ playerId: squad[0]._id.toString(), score: 4 }]
    })
  });
  assert.equal(editScoreRes.status, 200);
  const v8 = await getSyncVersion();
  assert.notEqual(v8, v7, 'PATCH /api/matches/:id/edit-scores must change sync version');

  // 8. PUT /api/matches/:id/entries (Replace entries on completed match)
  // Note: In Express (src/routes/matches.js:1122), broadcastServerSync was omitted on this legacy endpoint.
  // We verify the update succeeds (200) and assert whether version changed based on runtime target.
  await new Promise(r => setTimeout(r, 10));
  const entriesRes = await fetch(`${baseUrl}/api/matches/${match._id}/entries`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({
      entries: players.map(p => ({
        playerId: p._id.toString(),
        result: squad.some(s => s._id.toString() === p._id.toString()) ? 'played' : 'did_not_play',
        score: squad.some(s => s._id.toString() === p._id.toString()) ? 4 : null
      }))
    })
  });
  assert.equal(entriesRes.status, 200);
  const v9 = await getSyncVersion();
  if (process.env.TEST_TARGET === 'nextjs') {
    assert.notEqual(v9, v8, 'PUT /api/matches/:id/entries must change sync version on Next.js');
  } else {
    // Documented Express bug in KNOWN_ISSUES.md: Express does not broadcast on PUT /entries
    assert.equal(v9, v8, 'Express reference behavior: broadcastServerSync omitted on PUT /entries');
  }

  // 9. PATCH /api/matches/:id/reopen-for-edit (Reopen)
  await new Promise(r => setTimeout(r, 10));
  const reopenRes = await fetch(`${baseUrl}/api/matches/${match._id}/reopen-for-edit`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ reason: 'Score error' })
  });
  assert.equal(reopenRes.status, 200);
  const v10 = await getSyncVersion();
  assert.notEqual(v10, v9, 'PATCH /api/matches/:id/reopen-for-edit must change sync version');

  // 10. PATCH /api/matches/:id/cancel (Cancel)
  const m2Res = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      title: 'Match to Cancel',
      sport: 'Football',
      date,
      time: '18:00',
      opponent: 'Cancel FC',
      venue: 'Ground 2'
    })
  });
  const matchToCancel = await m2Res.json();
  const v11 = await getSyncVersion();
  await new Promise(r => setTimeout(r, 10));
  const cancelRes = await fetch(`${baseUrl}/api/matches/${matchToCancel._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ cancellationReason: 'Weather' })
  });
  assert.equal(cancelRes.status, 200);
  const v12 = await getSyncVersion();
  assert.notEqual(v12, v11, 'PATCH /api/matches/:id/cancel must change sync version');

  // 11. DELETE /api/matches/:id (Delete)
  await new Promise(r => setTimeout(r, 10));
  const delRes = await fetch(`${baseUrl}/api/matches/${matchToCancel._id}`, {
    method: 'DELETE',
    headers: authHeader(token)
  });
  assert.equal(delRes.status, 200);
  const v13 = await getSyncVersion();
  assert.notEqual(v13, v12, 'DELETE /api/matches/:id must change sync version');
});

