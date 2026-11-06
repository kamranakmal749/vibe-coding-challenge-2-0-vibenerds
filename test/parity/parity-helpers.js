// test/parity/parity-helpers.js
// Shared, self-contained helpers for the Phase 1 Parity Test Suite.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('../../src/app');
const User = require('../../src/models/User');
const Player = require('../../src/models/Player');
const Session = require('../../src/models/Session');
const Match = require('../../src/models/Match');
const MatchParticipation = require('../../src/models/MatchParticipation');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

let sharedServer = null;

// Enforce academy_parity database guard
function verifyParityDb() {
  const uri = process.env.MONGODB_URI || '';
  if (!/\/academy_parity\?/.test(uri) && !/\/academy_parity$/.test(uri)) {
    throw new Error('SAFETY ABORT: Parity test suite must run against academy_parity database!');
  }
}

async function startTestServer() {
  verifyParityDb();
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  if (!sharedServer) {
    sharedServer = app.listen(0);
  }
  const port = sharedServer.address().port;
  return `http://localhost:${port}`;
}

async function stopTestServer() {
  if (sharedServer) {
    try {
      if (typeof sharedServer.closeAllConnections === 'function') {
        sharedServer.closeAllConnections();
      }
      sharedServer.close();
    } catch (_) {}
    sharedServer = null;
  }
  try {
    const { getGlobalDispatcher } = require('undici');
    const dispatcher = getGlobalDispatcher();
    if (dispatcher && typeof dispatcher.destroy === 'function') {
      await dispatcher.destroy();
    }
  } catch (_) {}
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    try {
      const client = mongoose.connection.getClient();
      if (client) await client.close(true);
    } catch (_) {}
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
  setTimeout(() => {
    process.exit(process.exitCode || 0);
  }, 1000).unref();
}

function authHeader(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

function getPastDateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function createCoachFixture(prefix = 'c') {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const user = await User.create({
    name: `ParityCoach_${prefix}_${ts}`,
    username: `coach_${prefix}_${ts}`,
    email: `coach_${prefix}_${ts}@parity-test.com`,
    password: 'password123',
    role: 'coach'
  });
  const token = jwt.sign({ id: user._id, role: 'coach', username: user.username }, JWT_SECRET);
  return { coach: user, token };
}

async function createAdminFixture() {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const user = await User.create({
    name: `ParityAdmin_${ts}`,
    username: `admin_${ts}`,
    email: `admin_${ts}@parity-test.com`,
    password: 'adminpassword123',
    role: 'admin'
  });
  const token = jwt.sign({ id: user._id, role: 'admin', username: user.username }, JWT_SECRET);
  return { admin: user, token };
}

async function createScoutFixture() {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const user = await User.create({
    name: `ParityScout_${ts}`,
    username: `scout_${ts}`,
    email: `scout_${ts}@parity-test.com`,
    password: 'scoutpassword123',
    role: 'scout'
  });
  const token = jwt.sign({ id: user._id, role: 'scout', username: user.username }, JWT_SECRET);
  return { scout: user, token };
}

async function createPlayerTeamFixture(coachId, sport = 'Football', count = 12) {
  const players = [];
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  for (let i = 1; i <= count; i++) {
    const p = await Player.create({
      name: `Player_${ts}_${i}`,
      age: 18 + (i % 5),
      sport,
      coach: coachId,
      defaultParticipation: 'both'
    });
    players.push(p);
  }
  return players;
}

module.exports = {
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
  Player,
  Session,
  Match,
  MatchParticipation
};
