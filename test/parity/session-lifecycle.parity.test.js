// test/parity/session-lifecycle.parity.test.js
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

test('PARITY - Session: Open session, mark present/absent, save attendance', async () => {
  const { coach, token } = await createCoachFixture('sess_basic');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(2);

  // 1. Open session (captures initial roster snapshot of 12 players)
  const openRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  assert.equal(openRes.status, 201);
  const session = await openRes.json();
  assert.equal(session.initialRosterPlayerIds.length, 12);
  assert.equal(session.saved, false);

  // 2. Save session with 11 present, 1 absent
  const pAbsentId = players[0]._id.toString();
  const payload = {
    attendance: players.map((p, idx) => ({
      player: p._id.toString(),
      status: idx === 0 ? 'absent' : 'present'
    }))
  };
  const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify(payload)
  });
  assert.equal(saveRes.status, 200);
  const saved = await saveRes.json();
  const sessionObj = saved.session || saved;
  assert.equal(sessionObj.saved, true);
  assert.equal(sessionObj.locked, true);
  assert.equal(sessionObj.attendance.length, 12);

  // 3. GET saved session verifies populated attendance and correct statuses
  const getRes = await fetch(`${baseUrl}/api/sessions/${session._id}`, {
    headers: authHeader(token)
  });
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.attendance.length, 12);
  const absentEntry = fetched.attendance.find(a => (a.player?._id || a.player).toString() === pAbsentId);
  assert.equal(absentEntry.status, 'absent');
});

test('PARITY - Session: Closed/locked session returns 409 on subsequent edit attempts', async () => {
  const { coach, token } = await createCoachFixture('sess_closed');
  const players = await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(3);

  // Open & save session
  const openRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const session = await openRes.json();

  await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: session.attendance.map(a => ({ player: (a.player?._id || a.player).toString(), status: 'present' }))
    })
  });

  // Subsequent edit attempt must return 409
  const editRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({
      attendance: session.attendance.map(a => ({ player: (a.player?._id || a.player).toString(), status: 'absent' }))
    })
  });
  assert.equal(editRes.status, 409);

  // PATCH /mark on locked session also returns 409
  const markRes = await fetch(`${baseUrl}/api/sessions/${session._id}/mark`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ playerId: players[0]._id.toString(), status: 'absent' })
  });
  assert.equal(markRes.status, 409);
});

test('PARITY - Session: Duplicate session (same coach, date, sport) returns 409', async () => {
  const { coach, token } = await createCoachFixture('sess_dup');
  await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(4);

  const res1 = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  assert.equal(res1.status, 201);

  // Duplicate attempt
  const res2 = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  assert.equal(res2.status, 409);
});

test('PARITY - Session: Concurrent save requests (one succeeds, other returns 409)', async () => {
  const { coach, token } = await createCoachFixture('sess_concurrent');
  await createPlayerTeamFixture(coach._id, 'Football', 12);
  const date = getPastDateStr(5);

  const openRes = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ date, sport: 'Football' })
  });
  const session = await openRes.json();

  const payload = {
    attendance: session.attendance.map(a => ({ player: (a.player?._id || a.player).toString(), status: 'present' }))
  };

  // Dispatch two concurrent save requests
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/sessions/${session._id}/save`, { method: 'PATCH', headers: authHeader(token), body: JSON.stringify(payload) }),
    fetch(`${baseUrl}/api/sessions/${session._id}/save`, { method: 'PATCH', headers: authHeader(token), body: JSON.stringify(payload) })
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one save succeeds (200) and the other fails with conflict (409)');
});
