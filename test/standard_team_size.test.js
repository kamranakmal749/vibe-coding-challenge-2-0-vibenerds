// test/standard_team_size.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : 'http://localhost:3000';

async function authHeader(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

async function loginCoach() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'coach', password: 'coach123' })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Coach login failed');
  return data.token;
}

test('Standard Playing-Team Sizes and Match Validation Suite', async (t) => {
  const coachToken = await loginCoach();
  const headers = await authHeader(coachToken);

  await t.test('1. Check eligibility endpoint returns standard sizes for all 8 sports', async () => {
    const sportsExpectations = [
      { sport: 'Football', minSize: 11 },
      { sport: 'Cricket', minSize: 11 },
      { sport: 'Basketball', minSize: 5 },
      { sport: 'Volleyball', minSize: 6 },
      { sport: 'Field Hockey', minSize: 11 },
      { sport: 'Kabaddi', minSize: 7 },
      { sport: 'Badminton Singles', minSize: 1 },
      { sport: 'Badminton Doubles', minSize: 2 }
    ];

    for (const exp of sportsExpectations) {
      const res = await fetch(`${baseUrl}/api/matches/check-eligibility?sport=${encodeURIComponent(exp.sport)}&date=2028-05-15`, {
        headers
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.minTeamSize, exp.minSize, `Expected ${exp.sport} to have minTeamSize ${exp.minSize}`);
      assert.equal(data.sessionFinalized, false);
      assert.equal(data.message, 'Player selection will be available after practice attendance is recorded for the match date.');
    }
  });

  await t.test('2. Future match scheduling allows creating match with empty squad when session has not occurred yet', async () => {
    const rand = Math.floor(Math.random() * 100000);
    const futureDate = '2028-06-15';
    const res = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Future Championship Match ${rand}`,
        sport: 'Football',
        date: futureDate,
        time: '17:00',
        opponent: `Future Titans ${rand}`,
        venue: 'Grand Arena',
        description: 'Advance booking fixture'
      })
    });

    assert.equal(res.status, 201, `Expected 201 created, got ${res.status}`);
    const match = await res.json();
    assert.equal(match.sport, 'Football');
    assert.deepEqual(match.selectedPlayers, []);
    assert.equal(match.status, 'upcoming');

    // Clean up
    await fetch(`${baseUrl}/api/matches/${match._id}`, {
      method: 'DELETE',
      headers
    });
  });

  await t.test('3. Practice session with fewer eligible players than required blocks match creation', async () => {
    const testDate = `2029-${String(Math.floor(Math.random() * 11) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 25) + 1).padStart(2, '0')}`;

    // Basketball min 5 required. We mark only 3 players present and rest absent.
    const playersRes = await fetch(`${baseUrl}/api/players`, { headers });
    const allPlayers = await playersRes.json();
    const bbPlayers = allPlayers.filter(p => p.sport === 'Basketball');
    assert.ok(bbPlayers.length >= 3, 'Must have at least 3 basketball players in academy');

    // Create session
    const openRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sport: 'Basketball', date: testDate })
    });
    assert.equal(openRes.status, 201, 'Should create new session');
    const session = await openRes.json();
    assert.ok(session._id, 'Session should have _id');

    // Mark 3 players present, and the rest absent
    const attendancePayload = [
      ...bbPlayers.slice(0, 3).map(p => ({ player: p._id, status: 'present', participation: 'both' })),
      ...bbPlayers.slice(3).map(p => ({ player: p._id, status: 'absent' }))
    ];

    const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ attendance: attendancePayload })
    });
    assert.equal(saveRes.status, 200);

    // Check eligibility endpoint returns isBlocked: true
    const eligRes = await fetch(`${baseUrl}/api/matches/check-eligibility?sport=Basketball&date=${testDate}`, {
      headers
    });
    const eligData = await eligRes.json();
    assert.equal(eligData.sessionFinalized, true);
    assert.equal(eligData.isBlocked, true);
    assert.equal(eligData.minTeamSize, 5);
    assert.equal(eligData.totalEligible, 3);
    assert.match(eligData.message, /Basketball requires at least 5 eligible players, but only 3 are available/i);

    // Attempting to create match should return HTTP 400
    const matchRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Basketball League Match ${testDate}`,
        sport: 'Basketball',
        date: testDate,
        time: '18:00',
        opponent: 'City Hoopers',
        venue: 'Indoor Court'
      })
    });

    assert.equal(matchRes.status, 400);
    const errData = await matchRes.json();
    assert.match(errData.error, /Basketball requires at least 5 eligible players, but only 3 are available/i);
  });

  await t.test('4. Practice session with sufficient players: allows selecting min required or more (substitutes allowed)', async () => {
    const testDate = `2032-${String(Math.floor(Math.random() * 11) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 25) + 1).padStart(2, '0')}`;

    // Football has exactly 11 players in academy
    const playersRes = await fetch(`${baseUrl}/api/players`, { headers });
    const allPlayers = await playersRes.json();
    const fbPlayers = allPlayers.filter(p => p.sport === 'Football');
    assert.equal(fbPlayers.length, 11);

    // Create session
    const openRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sport: 'Football', date: testDate })
    });
    assert.equal(openRes.status, 201);
    const session = await openRes.json();

    // Mark all 11 present and save
    const attendancePayload = fbPlayers.map(p => ({
      player: p._id,
      status: 'present',
      participation: 'both'
    }));
    const saveRes = await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ attendance: attendancePayload })
    });
    assert.equal(saveRes.status, 200);

    // Case A: Create match without specifying selectedPlayerIds -> automatically selects all 11 eligible players
    const autoMatchRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Football Derby Auto-Squad ${testDate}`,
        sport: 'Football',
        date: testDate,
        time: '15:00',
        opponent: 'Rival FC',
        venue: 'Birsa Stadium'
      })
    });
    assert.equal(autoMatchRes.status, 201);
    const autoMatch = await autoMatchRes.json();
    assert.equal(autoMatch.selectedPlayers.length, 11);

    // Case B: Coach attempts to submit with only 10 players (< standard minimum 11) -> blocked with 400
    const shortSquadRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Football Short Squad Test ${testDate}`,
        sport: 'Football',
        date: testDate,
        time: '16:00',
        opponent: 'Rival FC 2',
        venue: 'Birsa Stadium',
        selectedPlayerIds: fbPlayers.slice(0, 10).map(p => p._id)
      })
    });
    assert.equal(shortSquadRes.status, 400);
    const shortErr = await shortSquadRes.json();
    assert.match(shortErr.error, /Football requires at least 11 selected players, but only 10 were selected/i);

    // Clean up match
    await fetch(`${baseUrl}/api/matches/${autoMatch._id}`, { method: 'DELETE', headers });
  });

  await t.test('5. Matches list returns standardTeamSize and minTeamSize separately', async () => {
    const rand = Math.floor(Math.random() * 100000);
    const testMatchRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Volleyball Exhibition ${rand}`,
        sport: 'Volleyball',
        date: '2028-09-01',
        time: '10:00',
        opponent: `Volley Club ${rand}`,
        venue: 'Court 1'
      })
    });
    assert.equal(testMatchRes.status, 201);
    const testMatch = await testMatchRes.json();

    const res = await fetch(`${baseUrl}/api/matches`, { headers });
    assert.equal(res.status, 200);
    const matches = await res.json();
    assert.ok(matches.length > 0, 'Should have at least one match');
    const vb = matches.find(m => m._id.toString() === testMatch._id.toString());
    assert.ok(vb);
    assert.equal(vb.standardTeamSize, 6, 'Volleyball standardTeamSize should be 6');
    assert.equal(vb.minTeamSize, 6, 'Volleyball minTeamSize should be 6');

    // Clean up
    await fetch(`${baseUrl}/api/matches/${testMatch._id}`, { method: 'DELETE', headers });
  });

  await t.test('6. Squad update and save-all enforce minTeamSize', async () => {
    const testDate = `2029-${String(Math.floor(Math.random() * 11) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 25) + 1).padStart(2, '0')}`;

    // Football
    const playersRes = await fetch(`${baseUrl}/api/players`, { headers });
    const allPlayers = await playersRes.json();
    const fbPlayers = allPlayers.filter(p => p.sport === 'Football');

    // Create session
    const openRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sport: 'Football', date: testDate })
    });
    const session = await openRes.json();

    // Mark 11 present
    await fetch(`${baseUrl}/api/sessions/${session._id}/save`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        attendance: fbPlayers.map(p => ({ player: p._id, status: 'present', participation: 'both' }))
      })
    });

    // Create match with all 11
    const matchRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Football Squad Update Test ${testDate}`,
        sport: 'Football',
        date: testDate,
        time: '14:00',
        opponent: 'Rovers FC',
        venue: 'Birsa Stadium'
      })
    });
    const match = await matchRes.json();
    assert.equal(match.selectedPlayers.length, 11);

    // Try reducing selected players to 9 via PUT /api/matches/:id/selected-players -> 400
    const putRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ playerIds: fbPlayers.slice(0, 9).map(p => p._id) })
    });
    assert.equal(putRes.status, 400);
    const putErr = await putRes.json();
    assert.match(putErr.error, /requires at least 11 selected players, but only 9 were selected/i);

    // Try reducing via POST /api/matches/:id/save-all -> 400
    const saveAllRes = await fetch(`${baseUrl}/api/matches/${match._id}/save-all`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ selectedPlayerIds: fbPlayers.slice(0, 8).map(p => p._id) })
    });
    assert.equal(saveAllRes.status, 400);

    // Clean up
    await fetch(`${baseUrl}/api/matches/${match._id}`, { method: 'DELETE', headers });
  });

  await t.test('7. 60-minute scoring unlock rule is preserved', async () => {
    // Scheduled at 16:00
    const rand = Math.floor(Math.random() * 100000);
    const matchRes = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `Lock Rule Test ${rand}`,
        sport: 'Football',
        date: '2028-11-10',
        time: '16:00',
        opponent: `Opponent ${rand}`,
        venue: 'Birsa Stadium'
      })
    });
    const match = await matchRes.json();

    const localKickoff = new Date(2028, 10, 10, 16, 0, 0);
    const mockBefore = new Date(localKickoff.getTime() + 30 * 60 * 1000).toISOString();
    const mockAfter = new Date(localKickoff.getTime() + 70 * 60 * 1000).toISOString();

    // Check match detail before unlock (at 16:30, kickoff was 16:00, unlock is 17:00)
    const checkRes = await fetch(`${baseUrl}/api/matches/${match._id}?mockNow=${encodeURIComponent(mockBefore)}`, {
      headers
    });
    const checkData = await checkRes.json();
    assert.equal(checkData.isScoringUnlocked, false);
    assert.equal(checkData.timeStatus, 'in_progress');

    // Check after unlock (at 17:10)
    const unlockRes = await fetch(`${baseUrl}/api/matches/${match._id}?mockNow=${encodeURIComponent(mockAfter)}`, {
      headers
    });
    const unlockData = await unlockRes.json();
    assert.equal(unlockData.isScoringUnlocked, true);
    assert.equal(unlockData.timeStatus, 'scoring_available');

    // Clean up
    await fetch(`${baseUrl}/api/matches/${match._id}`, { method: 'DELETE', headers });
  });
});
