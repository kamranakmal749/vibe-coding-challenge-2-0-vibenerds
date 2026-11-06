// test/match-phase8.test.js
// Unit & Integration tests for Phase 8: Add New Match & Match Details
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const User = require('../src/models/User');
const Match = require('../src/models/Match');
const Session = require('../src/models/Session');
const MatchParticipation = require('../src/models/MatchParticipation');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let server;
let baseUrl;
let coachUser;
let coachToken;
let otherCoach;
let otherToken;

function authHeader(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  if (process.env.BASE_URL) {
    baseUrl = process.env.BASE_URL.replace(/\/$/, '');
  } else {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  }

  coachUser = await User.create({
    name: 'Phase 8 Coach',
    username: `p8coach_${Date.now()}`,
    email: `p8coach_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  coachToken = jwt.sign({ id: coachUser._id, role: 'coach' }, JWT_SECRET);

  otherCoach = await User.create({
    name: 'Phase 8 Other Coach',
    username: `p8other_${Date.now()}`,
    email: `p8other_${Date.now()}@test.com`,
    password: 'password123',
    role: 'coach'
  });
  otherToken = jwt.sign({ id: otherCoach._id, role: 'coach' }, JWT_SECRET);
});

test.after(async () => {
  if (coachUser) {
    const coachMatches = await Match.find({ coach: coachUser._id });
    const matchIds = coachMatches.map(m => m._id);
    await MatchParticipation.deleteMany({ match: { $in: matchIds } });
    await Match.deleteMany({ coach: coachUser._id });
    await User.findByIdAndDelete(coachUser._id);
  }
  if (otherCoach) {
    const otherMatches = await Match.find({ coach: otherCoach._id });
    const matchIds = otherMatches.map(m => m._id);
    await MatchParticipation.deleteMany({ match: { $in: matchIds } });
    await Match.deleteMany({ coach: otherCoach._id });
    await User.findByIdAndDelete(otherCoach._id);
  }
  if (server) server.close();
  await mongoose.disconnect();
});

test('Phase 8: Add Match Form - validation, creation, duplicate guard', async () => {
  // 1. Missing required field (opponent missing)
  const invalidRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      title: 'Missing Opponent',
      sport: 'Football',
      date: '2026-11-10',
      time: '15:00',
      venue: 'Main Ground'
    })
  });
  assert.equal(invalidRes.status, 400);

  // 2. Successful creation
  const matchPayload = {
    title: 'Inter-District Cup Semi',
    sport: 'Football',
    date: '2026-11-10',
    time: '15:30',
    opponent: 'Bokaro United',
    venue: 'Sector 4 Stadium',
    description: 'Championship knockout match'
  };
  const createRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify(matchPayload)
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.title, 'Inter-District Cup Semi');
  assert.equal(created.status, 'upcoming');
  assert.equal(created.opponent, 'Bokaro United');

  // 3. Duplicate creation attempt (same coach, date, time, sport, opponent)
  const dupRes = await fetch(`${baseUrl}/api/matches`, {
    method: 'POST',
    headers: authHeader(coachToken),
    body: JSON.stringify(matchPayload)
  });
  assert.equal(dupRes.status, 409);
});

test('Phase 8: Match Details - GET /api/matches/:id returns complete schema & computed counts', async () => {
  const match = await Match.create({
    title: 'Friendly against Dhanbad Academy',
    sport: 'Football',
    date: new Date('2026-11-12'),
    time: '10:00',
    opponent: 'Dhanbad Academy',
    venue: 'Railway Stadium',
    coach: coachUser._id,
    status: 'upcoming'
  });

  const res = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    headers: authHeader(coachToken)
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.title, 'Friendly against Dhanbad Academy');
  assert.equal(data.venue, 'Railway Stadium');
  assert.equal(typeof data.totalEligiblePlayers, 'number');
  assert.equal(typeof data.totalPlayed, 'number');
  assert.equal(typeof data.totalDidNotPlay, 'number');

  // Forbidden for other coaches
  const forbiddenRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    headers: authHeader(otherToken)
  });
  assert.equal(forbiddenRes.status, 403);
});

test('Phase 8: Edit Match - PATCH /api/matches/:id edits upcoming match, rejects non-upcoming', async () => {
  const match = await Match.create({
    title: 'Pre-season Friendly',
    sport: 'Football',
    date: new Date('2026-11-15'),
    time: '11:00',
    opponent: 'Ranchi FC',
    venue: 'Ground A',
    coach: coachUser._id,
    status: 'upcoming'
  });

  // Edit upcoming match
  const editRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({
      venue: 'Ground B (Upgraded)',
      time: '11:30'
    })
  });
  assert.equal(editRes.status, 200);
  const updated = await editRes.json();
  assert.equal(updated.venue, 'Ground B (Upgraded)');
  assert.equal(updated.time, '11:30');

  // Change status to completed and verify edits are rejected
  match.status = 'completed';
  await match.save();

  const rejectedRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    method: 'PATCH',
    headers: authHeader(coachToken),
    body: JSON.stringify({ venue: 'Ground C' })
  });
  assert.equal(rejectedRes.status, 409);
});

test('Phase 8: Cancel Match - PATCH /api/matches/:id/cancel cancels upcoming, rejects non-upcoming', async () => {
  const match = await Match.create({
    title: 'Rainout Fixture',
    sport: 'Football',
    date: new Date('2026-11-18'),
    time: '16:00',
    opponent: 'Tata Steel',
    venue: 'Jamshedpur',
    coach: coachUser._id,
    status: 'upcoming'
  });

  // Cancel match
  const cancelRes = await fetch(`${baseUrl}/api/matches/${match._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.match.status, 'cancelled');

  // Cancelling an already cancelled match returns 409
  const reCancelRes = await fetch(`${baseUrl}/api/matches/${match._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(coachToken)
  });
  assert.equal(reCancelRes.status, 409);
});

test('Phase 8: Comprehensive 403 cross-coach guards on all match endpoints', async () => {
  const match = await Match.create({
    title: 'Coach 1 Exclusive Match',
    sport: 'Football',
    date: new Date('2026-11-20'),
    time: '16:00',
    opponent: 'Bokaro XI',
    venue: 'Sector 4 Ground',
    coach: coachUser._id,
    status: 'upcoming'
  });

  const dummyPlayerId = new mongoose.Types.ObjectId();

  // 1. GET /api/matches/:id
  const getRes = await fetch(`${baseUrl}/api/matches/${match._id}`, { headers: authHeader(otherToken) });
  assert.equal(getRes.status, 403, 'GET /api/matches/:id must return 403 for other coach');

  // 2. PATCH /api/matches/:id
  const patchRes = await fetch(`${baseUrl}/api/matches/${match._id}`, {
    method: 'PATCH',
    headers: authHeader(otherToken),
    body: JSON.stringify({ venue: 'Unauthorized Edit' })
  });
  assert.equal(patchRes.status, 403, 'PATCH /api/matches/:id must return 403 for other coach');

  // 3. PATCH /api/matches/:id/cancel
  const cancelRes = await fetch(`${baseUrl}/api/matches/${match._id}/cancel`, {
    method: 'PATCH',
    headers: authHeader(otherToken)
  });
  assert.equal(cancelRes.status, 403, 'PATCH /api/matches/:id/cancel must return 403 for other coach');

  // 4. GET /api/matches/:id/eligible-players
  const eligRes = await fetch(`${baseUrl}/api/matches/${match._id}/eligible-players`, { headers: authHeader(otherToken) });
  assert.equal(eligRes.status, 403, 'GET /api/matches/:id/eligible-players must return 403 for other coach');

  // 5. PUT /api/matches/:id/selected-players
  const selRes = await fetch(`${baseUrl}/api/matches/${match._id}/selected-players`, {
    method: 'PUT',
    headers: authHeader(otherToken),
    body: JSON.stringify({ playerIds: [dummyPlayerId.toString()] })
  });
  assert.equal(selRes.status, 403, 'PUT /api/matches/:id/selected-players must return 403 for other coach');

  // 6. GET /api/matches/:id/participation
  const partRes = await fetch(`${baseUrl}/api/matches/${match._id}/participation`, { headers: authHeader(otherToken) });
  assert.equal(partRes.status, 403, 'GET /api/matches/:id/participation must return 403 for other coach');

  // 7. PATCH /api/matches/:id/participation/:playerId
  const partPatchRes = await fetch(`${baseUrl}/api/matches/${match._id}/participation/${dummyPlayerId}`, {
    method: 'PATCH',
    headers: authHeader(otherToken),
    body: JSON.stringify({ played: true, score: 2 })
  });
  assert.equal(partPatchRes.status, 403, 'PATCH /api/matches/:id/participation/:playerId must return 403 for other coach');

  // 8. PATCH /api/matches/:id/complete
  const compRes = await fetch(`${baseUrl}/api/matches/${match._id}/complete`, {
    method: 'PATCH',
    headers: authHeader(otherToken)
  });
  assert.equal(compRes.status, 403, 'PATCH /api/matches/:id/complete must return 403 for other coach');

  // 9. PATCH /api/matches/:id/reopen-for-edit
  const reopenRes = await fetch(`${baseUrl}/api/matches/${match._id}/reopen-for-edit`, {
    method: 'PATCH',
    headers: authHeader(otherToken)
  });
  assert.equal(reopenRes.status, 403, 'PATCH /api/matches/:id/reopen-for-edit must return 403 for other coach');

  // 10. GET /api/matches (list scoping)
  const listRes = await fetch(`${baseUrl}/api/matches`, { headers: authHeader(otherToken) });
  const listData = await listRes.json();
  assert.equal(listData.some(m => m._id.toString() === match._id.toString()), false, 'GET /api/matches must exclude other coach matches');

  // 11. GET /api/matches/calendar (calendar scoping)
  const calRes = await fetch(`${baseUrl}/api/matches/calendar?month=2026-11`, { headers: authHeader(otherToken) });
  const calData = await calRes.json();
  assert.equal(calData.some(m => m._id.toString() === match._id.toString()), false, 'GET /api/matches/calendar must exclude other coach matches');

  // 12. GET /api/matches/history (history scoping)
  match.status = 'completed';
  await match.save();
  const histRes = await fetch(`${baseUrl}/api/matches/history`, { headers: authHeader(otherToken) });
  const histData = await histRes.json();
  assert.equal(histData.some(m => m._id.toString() === match._id.toString()), false, 'GET /api/matches/history must exclude other coach matches');
});
