require('dns').setServers(['8.8.8.8', '1.1.1.1']);
// scripts/seed.js – Creates test users and players for production verification.
// Run: node scripts/seed.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../src/models/User');
const Player   = require('../src/models/Player');
const Session  = require('../src/models/Session');
const Match    = require('../src/models/Match');
const MatchParticipation = require('../src/models/MatchParticipation');
const Counter  = require('../src/models/Counter');

function maskUri(uri) {
  if (!uri) return '';
  return uri.replace(/\/\/(.*):(.*)@/, '//$1:****@');
}

function extractDbName(uri) {
  if (!uri) return '';
  const withoutQuery = uri.split('?')[0];
  const parts = withoutQuery.split('/');
  return parts[parts.length - 1] || '';
}

const DEMO_USERS = [
  { _id: new mongoose.Types.ObjectId('65f000000000000000000001'), name: 'Academy Admin', username: 'admin',  email: 'admin@maidandesk.com', password: 'admin123',  role: 'admin'  },
  { _id: new mongoose.Types.ObjectId('65f000000000000000000002'), name: 'Coach Sharma',  username: 'coach',  email: 'coach@maidandesk.com', password: 'coach123',  role: 'coach'  },
  { _id: new mongoose.Types.ObjectId('65f000000000000000000003'), name: 'Scout Verma',   username: 'scout',  email: 'scout@maidandesk.com', password: 'scout123',  role: 'scout'  },
];

function getDateOffset(daysAgo, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

const twoDaysAgo = getDateOffset(2);

const PLAYERS_DATA = [
  { name: 'Kamran Akmal',   age: 20, sport: 'Football', username: 'kamran',  email: 'kamran@player.com', registeredOn: twoDaysAgo, defaultParticipation: 'both' },
  { name: 'Krishna Ashish', age: 19, sport: 'Football', username: 'krishna', email: 'krishna@player.com', registeredOn: twoDaysAgo, defaultParticipation: 'both' },
  { name: 'Aadil Azhar',    age: 22, sport: 'Football', username: 'aadil',   email: 'aadil@player.com',   registeredOn: twoDaysAgo, defaultParticipation: 'both' },
  { name: 'Akarsh Raj',     age: 21, sport: 'Football', username: 'akarsh',  email: 'akarsh@player.com',  registeredOn: twoDaysAgo, defaultParticipation: 'practice' }
];

const set1Specs = [
  { name: 'Rohan Mehta',   age: 17, sport: 'Football',   username: 'rohan',   email: 'rohan@player.com',   daysAgo: 90, defaultParticipation: 'both' },
  { name: 'Simran Kaur',   age: 16, sport: 'Cricket',    username: 'simran',  email: 'simran@player.com',  daysAgo: 60, defaultParticipation: 'both' },
  { name: 'Vivaan Sharma', age: 18, sport: 'Basketball', username: 'vivaan',  email: 'vivaan@player.com',  daysAgo: 30, defaultParticipation: 'both' },
  { name: 'Ananya Singh',  age: 15, sport: 'Football',   username: 'ananya',  email: 'ananya@player.com',  daysAgo: 32, defaultParticipation: 'both' },
  { name: 'Arjun Nair',    age: 19, sport: 'Cricket',    username: 'arjun',   email: 'arjun@player.com',   daysAgo: 30, defaultParticipation: 'both' }
];

const set2Config = {
  Football: {
    players: [
      { name: 'Kabir Verma',   age: 18, daysAgo: 100, defaultParticipation: 'both' },     // P1: READY (2/2, 2+ matches)
      { name: 'Ishaan Gupta',  age: 17, daysAgo: 85,  defaultParticipation: 'both' },     // P2: READY (2/2, 2+ matches)
      { name: 'Devendra Das',  age: 19, daysAgo: 70,  defaultParticipation: 'both' },     // P3: NOT READY (1/2, 1 match - fails both)
      { name: 'Aryan Joshi',   age: 16, daysAgo: 45,  defaultParticipation: 'both' },     // P4: NOT READY (2/2, 0 or 1 match - fails match)
      { name: 'Sameer Khan',   age: 20, daysAgo: 26,  defaultParticipation: 'both' }      // P5: NOT READY (1/2, 2 matches - fails attendance)
    ],
    sessDays: [24, 23],
    opponents: ['Deoghar Dynamos', 'Hazaribagh Heroes', 'Bokaro Blasters']
  },
  Basketball: {
    players: [
      { name: 'Tanmay Bhatia',     age: 18, daysAgo: 95, defaultParticipation: 'both' },  // P1: READY
      { name: 'Yuvraj Choudhury',  age: 17, daysAgo: 80, defaultParticipation: 'both' },  // P2: READY
      { name: 'Manish Pandey',     age: 19, daysAgo: 65, defaultParticipation: 'both' },  // P3: NOT READY (fails both)
      { name: 'Pranav Rao',        age: 15, daysAgo: 40, defaultParticipation: 'both' },  // P4: NOT READY (fails match)
      { name: 'Kunal Singhania',   age: 20, daysAgo: 24, defaultParticipation: 'both' }   // P5: NOT READY (fails attendance)
    ],
    sessDays: [22, 21],
    opponents: ['Bokaro Ballers', 'Dhanbad Dunkers', 'Ranchi Rim Rockers']
  },
  Cricket: {
    players: [
      { name: 'Harshit Tiwari',  age: 18, daysAgo: 110, defaultParticipation: 'both' },   // P1: READY
      { name: 'Deepak Yadav',    age: 19, daysAgo: 75,  defaultParticipation: 'both' },   // P2: READY
      { name: 'Nikhil Saxena',   age: 16, daysAgo: 60,  defaultParticipation: 'both' },   // P3: NOT READY (fails both)
      { name: 'Shubham Gillani', age: 15, daysAgo: 35,  defaultParticipation: 'both' },   // P4: NOT READY (fails match)
      { name: 'Varun Malhotra',  age: 20, daysAgo: 22,  defaultParticipation: 'both' }    // P5: NOT READY (fails attendance)
    ],
    sessDays: [20, 19],
    opponents: ['Dhanbad Daredevils', 'Ranchi Royals', 'Jamshedpur Juggernauts']
  }
};

function isPlayerEligible(player, sessionDate, sessionSport) {
  if ((player.sport || '').toLowerCase() !== (sessionSport || '').toLowerCase()) return false;
  const sessEnd = new Date(sessionDate);
  sessEnd.setHours(23, 59, 59, 999);
  const sessUtcEnd = new Date(sessionDate);
  sessUtcEnd.setUTCHours(23, 59, 59, 999);
  const maxEnd = sessEnd > sessUtcEnd ? sessEnd : sessUtcEnd;
  if (new Date(player.registeredOn) > maxEnd) return false;
  const part = (player.defaultParticipation || 'both').toLowerCase();
  if (part !== 'practice' && part !== 'both') return false;
  return true;
}

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('FATAL: MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }

  const dbName = extractDbName(uri);
  const maskedUri = maskUri(uri);

  console.log(`[SEED GUARD] Target Database: ${dbName}`);
  console.log(`[SEED GUARD] Target URI: ${maskedUri}`);

  // Hard safety guard: refuse to run unless DB name is EXACTLY academy_final AND ALLOW_PRODUCTION_DB=true
  if (dbName !== 'academy_final') {
    console.error(`FATAL: Guard Refusal! Target database "${dbName}" is not "academy_final". Seeding is strictly forbidden to protect backup databases.`);
    process.exit(1);
  }

  if (process.env.ALLOW_PRODUCTION_DB !== 'true') {
    console.error('FATAL: Guard Refusal! ALLOW_PRODUCTION_DB must be set to "true" to seed academy_final.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  // Clean existing collections
  await User.deleteMany({});
  await Player.deleteMany({});
  await Session.deleteMany({});
  await Match.deleteMany({});
  await MatchParticipation.deleteMany({});
  await Counter.deleteMany({});
  console.log('🧹 Cleaned existing data.');

  // Create staff users (admin, coach, scout)
  for (const u of DEMO_USERS) {
    const user = new User(u);
    await user.save();
    console.log(`✅ Created staff user: ${u.username} / ${u.password} [${u.role}]`);
  }

  const coach = await User.findOne({ username: 'coach' });

  // ── 1. ORIGINAL SEEDED PLAYERS (Kamran, Krishna, Aadil, Akarsh) ──
  const createdPlayers = [];
  for (const p of PLAYERS_DATA) {
    const player = await Player.create({
      name: p.name,
      age: p.age,
      sport: p.sport,
      registeredOn: p.registeredOn,
      defaultParticipation: p.defaultParticipation,
      coach: coach._id
    });

    const playerUser = new User({
      name: p.name,
      username: player.playerId, // Permanent unique playerId (md<YY><sequence>)
      email: p.email,
      password: 'player123',
      role: 'player',
      playerId: player._id
    });
    await playerUser.save();
    createdPlayers.push(player);
    console.log(`✅ Created player & login: ${p.name} (username: ${player.playerId} / player123, email: ${p.email}, age: ${p.age}, default: ${p.defaultParticipation})`);
  }

  // ── 2. SET 1 — NAMED PLAYERS (5 PLAYERS) ──
  console.log('\n--- Seeding Set 1: Named Players ---');
  const set1Players = {};
  for (const s of set1Specs) {
    const regDate = getDateOffset(s.daysAgo);
    const p = await Player.create({
      name: s.name,
      age: s.age,
      sport: s.sport,
      registeredOn: regDate,
      defaultParticipation: s.defaultParticipation,
      coach: coach._id
    });
    const pu = new User({
      name: s.name,
      username: p.playerId,
      email: s.email,
      password: 'player123',
      role: 'player',
      playerId: p._id
    });
    await pu.save();
    set1Players[s.name] = p;
    console.log(`✅ Created Set 1 player: ${s.name} [${s.sport}] (username: ${p.playerId}, email: ${s.email})`);
  }

  // ── 3. SET 2 — SPORT-BASED PLAYERS (15 PLAYERS, 5 PER SPORT) ──
  console.log('\n--- Seeding Set 2: Sport-based Players ---');
  const set2CreatedPlayers = [];
  const set2PlayersBySport = { Football: [], Basketball: [], Cricket: [] };

  for (const [sport, cfg] of Object.entries(set2Config)) {
    for (let i = 0; i < cfg.players.length; i++) {
      const pData = cfg.players[i];
      const uname = pData.name.toLowerCase().replace(/\s+/g, '_');
      const regDate = getDateOffset(pData.daysAgo);
      const player = await Player.create({
        name: pData.name,
        age: pData.age,
        sport,
        registeredOn: regDate,
        defaultParticipation: pData.defaultParticipation,
        coach: coach._id
      });
      const pu = new User({
        name: pData.name,
        username: player.playerId,
        email: `${uname}@player.com`,
        password: 'player123',
        role: 'player',
        playerId: player._id
      });
      await pu.save();
      set2PlayersBySport[sport].push(player);
      set2CreatedPlayers.push({ player, sport, patternNum: i + 1 });
      console.log(`✅ Created Set 2 [${sport}] player: ${pData.name} (username: ${player.playerId}, P${i+1})`);
    }
  }

  // Master list of all 24 players in DB
  const allAcademyPlayers = [
    ...createdPlayers,
    ...Object.values(set1Players),
    ...set2CreatedPlayers.map(sp => sp.player)
  ];

  // Helper to build full attendance array for ALL eligible players of a session
  function buildSessionAttendance(sessionDate, sessionSport, statusOverrides = {}) {
    const eligible = allAcademyPlayers.filter(p => isPlayerEligible(p, sessionDate, sessionSport));
    return eligible.map(p => {
      const override = statusOverrides[p.name] || {};
      const status = override.status || 'present';
      const participation = status === 'absent'
        ? null
        : (override.participation || (p.defaultParticipation === 'practice' ? 'practice' : 'both'));
      return {
        player: p._id,
        status,
        participation
      };
    });
  }

  // ── 4. SESSIONS (14 SESSIONS TOTAL, EVERY ELIGIBLE PLAYER IN ATTENDANCE) ──
  console.log('\n--- Seeding 14 Attendance Sessions with Complete Eligible Rosters ---');

  // Set 1 Football (days 30 & 29)
  const d_s1_f1 = getDateOffset(30);
  const d_s1_f2 = getDateOffset(29);
  const att_s1_f1 = buildSessionAttendance(d_s1_f1, 'Football');
  const s1_f_sess1 = await Session.create({
    date: d_s1_f1,
    sport: 'Football',
    coach: coach._id,
    saved: true,
    savedAt: d_s1_f1,
    locked: true,
    attendance: att_s1_f1,
    initialRosterPlayerIds: att_s1_f1.map(a => a.player),
    createdWithCount: att_s1_f1.length
  });

  const att_s1_f2 = buildSessionAttendance(d_s1_f2, 'Football');
  const s1_f_sess2 = await Session.create({
    date: d_s1_f2,
    sport: 'Football',
    coach: coach._id,
    saved: true,
    savedAt: d_s1_f2,
    locked: true,
    attendance: att_s1_f2,
    initialRosterPlayerIds: att_s1_f2.map(a => a.player),
    createdWithCount: att_s1_f2.length
  });

  // Set 1 Matches (Football)
  const s1_f_m1 = await Match.create({
    title: 'Set1 Cup vs Bokaro FC',
    sport: 'Football',
    date: d_s1_f1,
    time: '15:00',
    opponent: 'Bokaro FC',
    venue: 'Bokaro Stadium',
    status: 'completed',
    coach: coach._id,
    sessionId: s1_f_sess1._id,
    selectedPlayers: [set1Players['Rohan Mehta']._id],
    entries: [{ player: set1Players['Rohan Mehta']._id, result: 'played', score: 2 }]
  });
  await MatchParticipation.create([
    { match: s1_f_m1._id, player: set1Players['Rohan Mehta']._id, played: true, score: 2, remarks: 'Solid forward play' }
  ]);

  const s1_f_m2 = await Match.create({
    title: 'Set1 League vs Dhanbad City',
    sport: 'Football',
    date: d_s1_f2,
    time: '15:00',
    opponent: 'Dhanbad City',
    venue: 'Dhanbad Stadium',
    status: 'completed',
    coach: coach._id,
    sessionId: s1_f_sess2._id,
    selectedPlayers: [set1Players['Rohan Mehta']._id],
    entries: [{ player: set1Players['Rohan Mehta']._id, result: 'played', score: 1 }]
  });
  await MatchParticipation.create([
    { match: s1_f_m2._id, player: set1Players['Rohan Mehta']._id, played: true, score: 1, remarks: 'Decisive penalty' }
  ]);

  // Set 1 Cricket (days 28 & 27)
  const d_s1_c1 = getDateOffset(28);
  const d_s1_c2 = getDateOffset(27);
  const att_s1_c1 = buildSessionAttendance(d_s1_c1, 'Cricket');
  const s1_c_sess1 = await Session.create({
    date: d_s1_c1,
    sport: 'Cricket',
    coach: coach._id,
    saved: true,
    savedAt: d_s1_c1,
    locked: true,
    attendance: att_s1_c1,
    initialRosterPlayerIds: att_s1_c1.map(a => a.player),
    createdWithCount: att_s1_c1.length
  });

  const att_s1_c2 = buildSessionAttendance(d_s1_c2, 'Cricket', { 'Arjun Nair': { status: 'absent' } });
  const s1_c_sess2 = await Session.create({
    date: d_s1_c2,
    sport: 'Cricket',
    coach: coach._id,
    saved: true,
    savedAt: d_s1_c2,
    locked: true,
    attendance: att_s1_c2,
    initialRosterPlayerIds: att_s1_c2.map(a => a.player),
    createdWithCount: att_s1_c2.length
  });

  // Set 1 Matches (Cricket)
  const s1_c_m1 = await Match.create({
    title: 'T20 Trophy vs Ranchi Strikers',
    sport: 'Cricket',
    date: d_s1_c1,
    time: '10:00',
    opponent: 'Ranchi Strikers',
    venue: 'JSCA Ground 2',
    status: 'completed',
    coach: coach._id,
    sessionId: s1_c_sess1._id,
    selectedPlayers: [set1Players['Simran Kaur']._id, set1Players['Arjun Nair']._id],
    entries: [
      { player: set1Players['Simran Kaur']._id, result: 'played', score: 15 },
      { player: set1Players['Arjun Nair']._id,   result: 'played', score: 18 }
    ]
  });
  await MatchParticipation.create([
    { match: s1_c_m1._id, player: set1Players['Simran Kaur']._id, played: true, score: 15, remarks: 'Opening stand' },
    { match: s1_c_m1._id, player: set1Players['Arjun Nair']._id,   played: true, score: 18, remarks: 'Top scorer' }
  ]);

  const s1_c_m2 = await Match.create({
    title: 'T20 Trophy vs Jamshedpur Blasters',
    sport: 'Cricket',
    date: d_s1_c1,
    time: '15:00',
    opponent: 'Jamshedpur Blasters',
    venue: 'JSCA Ground 2',
    status: 'completed',
    coach: coach._id,
    sessionId: s1_c_sess1._id,
    selectedPlayers: [set1Players['Simran Kaur']._id, set1Players['Arjun Nair']._id],
    entries: [
      { player: set1Players['Simran Kaur']._id, result: 'played', score: 20 },
      { player: set1Players['Arjun Nair']._id,   result: 'played', score: 12 }
    ]
  });
  await MatchParticipation.create([
    { match: s1_c_m2._id, player: set1Players['Simran Kaur']._id, played: true, score: 20, remarks: 'Unbeaten half-century' },
    { match: s1_c_m2._id, player: set1Players['Arjun Nair']._id,   played: true, score: 12, remarks: 'Late boundary surge' }
  ]);

  // Set 1 Basketball (days 26 & 25)
  const d_s1_b1 = getDateOffset(26);
  const d_s1_b2 = getDateOffset(25);
  const att_s1_b1 = buildSessionAttendance(d_s1_b1, 'Basketball', { 'Vivaan Sharma': { status: 'absent' } });
  const s1_b_sess1 = await Session.create({
    date: d_s1_b1,
    sport: 'Basketball',
    coach: coach._id,
    saved: true,
    savedAt: d_s1_b1,
    locked: true,
    attendance: att_s1_b1,
    initialRosterPlayerIds: att_s1_b1.map(a => a.player),
    createdWithCount: att_s1_b1.length
  });

  const att_s1_b2 = buildSessionAttendance(d_s1_b2, 'Basketball');
  const s1_b_sess2 = await Session.create({
    date: d_s1_b2,
    sport: 'Basketball',
    coach: coach._id,
    saved: true,
    savedAt: d_s1_b2,
    locked: true,
    attendance: att_s1_b2,
    initialRosterPlayerIds: att_s1_b2.map(a => a.player),
    createdWithCount: att_s1_b2.length
  });

  const s1_b_m1 = await Match.create({
    title: 'Inter-District vs Ranchi Hoops',
    sport: 'Basketball',
    date: d_s1_b2,
    time: '16:00',
    opponent: 'Ranchi Hoops',
    venue: 'Indoor Court A',
    status: 'completed',
    coach: coach._id,
    sessionId: s1_b_sess2._id,
    selectedPlayers: [set1Players['Vivaan Sharma']._id],
    entries: [{ player: set1Players['Vivaan Sharma']._id, result: 'played', score: 14 }]
  });
  await MatchParticipation.create([
    { match: s1_b_m1._id, player: set1Players['Vivaan Sharma']._id, played: true, score: 14, remarks: 'Strong rebounds' }
  ]);

  // Set 2 Football (days 24 & 23)
  const d_s2_f1 = getDateOffset(24);
  const d_s2_f2 = getDateOffset(23);
  const att_s2_f1 = buildSessionAttendance(d_s2_f1, 'Football');
  const s2_f_sess1 = await Session.create({
    date: d_s2_f1,
    sport: 'Football',
    coach: coach._id,
    saved: true,
    savedAt: d_s2_f1,
    locked: true,
    attendance: att_s2_f1,
    initialRosterPlayerIds: att_s2_f1.map(a => a.player),
    createdWithCount: att_s2_f1.length
  });

  const att_s2_f2 = buildSessionAttendance(d_s2_f2, 'Football', {
    'Devendra Das': { status: 'absent' },
    'Sameer Khan':  { status: 'absent' }
  });
  const s2_f_sess2 = await Session.create({
    date: d_s2_f2,
    sport: 'Football',
    coach: coach._id,
    saved: true,
    savedAt: d_s2_f2,
    locked: true,
    attendance: att_s2_f2,
    initialRosterPlayerIds: att_s2_f2.map(a => a.player),
    createdWithCount: att_s2_f2.length
  });

  // Set 2 Football Matches
  const fbP = set2PlayersBySport.Football;
  const s2_f_m1 = await Match.create({
    title: `Football Series vs ${set2Config.Football.opponents[0]}`,
    sport: 'Football',
    date: d_s2_f1,
    time: '10:00',
    opponent: set2Config.Football.opponents[0],
    venue: 'Complex Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: s2_f_sess1._id,
    selectedPlayers: [fbP[0]._id, fbP[1]._id, fbP[2]._id, fbP[4]._id],
    entries: [
      { player: fbP[0]._id, result: 'played', score: 10 },
      { player: fbP[1]._id, result: 'played', score: 12 },
      { player: fbP[2]._id, result: 'played', score: 8 },
      { player: fbP[4]._id, result: 'played', score: 15 }
    ]
  });
  await MatchParticipation.create([
    { match: s2_f_m1._id, player: fbP[0]._id, played: true, score: 10, remarks: 'Good opener' },
    { match: s2_f_m1._id, player: fbP[1]._id, played: true, score: 12, remarks: 'Solid effort' },
    { match: s2_f_m1._id, player: fbP[2]._id, played: true, score: 8,  remarks: 'Only match played' },
    { match: s2_f_m1._id, player: fbP[4]._id, played: true, score: 15, remarks: 'First match' }
  ]);

  const s2_f_m2 = await Match.create({
    title: `Football Series vs ${set2Config.Football.opponents[1]}`,
    sport: 'Football',
    date: d_s2_f1,
    time: '15:30',
    opponent: set2Config.Football.opponents[1],
    venue: 'Complex Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: s2_f_sess1._id,
    selectedPlayers: [fbP[0]._id, fbP[1]._id, fbP[4]._id],
    entries: [
      { player: fbP[0]._id, result: 'played', score: 14 },
      { player: fbP[1]._id, result: 'played', score: 11 },
      { player: fbP[4]._id, result: 'played', score: 18 }
    ]
  });
  await MatchParticipation.create([
    { match: s2_f_m2._id, player: fbP[0]._id, played: true, score: 14, remarks: 'Second match' },
    { match: s2_f_m2._id, player: fbP[1]._id, played: true, score: 11, remarks: 'Consistent' },
    { match: s2_f_m2._id, player: fbP[4]._id, played: true, score: 18, remarks: 'Second match' }
  ]);

  // Set 2 Basketball (days 22 & 21)
  const d_s2_b1 = getDateOffset(22);
  const d_s2_b2 = getDateOffset(21);
  const att_s2_b1 = buildSessionAttendance(d_s2_b1, 'Basketball', {
    'Vivaan Sharma': { status: 'absent' }
  });
  const s2_b_sess1 = await Session.create({
    date: d_s2_b1,
    sport: 'Basketball',
    coach: coach._id,
    saved: true,
    savedAt: d_s2_b1,
    locked: true,
    attendance: att_s2_b1,
    initialRosterPlayerIds: att_s2_b1.map(a => a.player),
    createdWithCount: att_s2_b1.length
  });

  const att_s2_b2 = buildSessionAttendance(d_s2_b2, 'Basketball', {
    'Vivaan Sharma':   { status: 'absent' },
    'Manish Pandey':   { status: 'absent' },
    'Kunal Singhania': { status: 'absent' }
  });
  const s2_b_sess2 = await Session.create({
    date: d_s2_b2,
    sport: 'Basketball',
    coach: coach._id,
    saved: true,
    savedAt: d_s2_b2,
    locked: true,
    attendance: att_s2_b2,
    initialRosterPlayerIds: att_s2_b2.map(a => a.player),
    createdWithCount: att_s2_b2.length
  });

  // Set 2 Basketball Matches
  const bbP = set2PlayersBySport.Basketball;
  const s2_b_m1 = await Match.create({
    title: `Basketball Series vs ${set2Config.Basketball.opponents[0]}`,
    sport: 'Basketball',
    date: d_s2_b1,
    time: '10:00',
    opponent: set2Config.Basketball.opponents[0],
    venue: 'Complex Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: s2_b_sess1._id,
    selectedPlayers: [bbP[0]._id, bbP[1]._id, bbP[2]._id, bbP[4]._id],
    entries: [
      { player: bbP[0]._id, result: 'played', score: 10 },
      { player: bbP[1]._id, result: 'played', score: 12 },
      { player: bbP[2]._id, result: 'played', score: 8 },
      { player: bbP[4]._id, result: 'played', score: 15 }
    ]
  });
  await MatchParticipation.create([
    { match: s2_b_m1._id, player: bbP[0]._id, played: true, score: 10, remarks: 'Good opener' },
    { match: s2_b_m1._id, player: bbP[1]._id, played: true, score: 12, remarks: 'Solid effort' },
    { match: s2_b_m1._id, player: bbP[2]._id, played: true, score: 8,  remarks: 'Only match played' },
    { match: s2_b_m1._id, player: bbP[4]._id, played: true, score: 15, remarks: 'First match' }
  ]);

  const s2_b_m2 = await Match.create({
    title: `Basketball Series vs ${set2Config.Basketball.opponents[1]}`,
    sport: 'Basketball',
    date: d_s2_b1,
    time: '15:30',
    opponent: set2Config.Basketball.opponents[1],
    venue: 'Complex Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: s2_b_sess1._id,
    selectedPlayers: [bbP[0]._id, bbP[1]._id, bbP[4]._id],
    entries: [
      { player: bbP[0]._id, result: 'played', score: 14 },
      { player: bbP[1]._id, result: 'played', score: 11 },
      { player: bbP[4]._id, result: 'played', score: 18 }
    ]
  });
  await MatchParticipation.create([
    { match: s2_b_m2._id, player: bbP[0]._id, played: true, score: 14, remarks: 'Second match' },
    { match: s2_b_m2._id, player: bbP[1]._id, played: true, score: 11, remarks: 'Consistent' },
    { match: s2_b_m2._id, player: bbP[4]._id, played: true, score: 18, remarks: 'Second match' }
  ]);

  // Set 2 Cricket (days 20 & 19)
  const d_s2_c1 = getDateOffset(20);
  const d_s2_c2 = getDateOffset(19);
  const att_s2_c1 = buildSessionAttendance(d_s2_c1, 'Cricket', {
    'Arjun Nair': { status: 'absent' }
  });
  const s2_c_sess1 = await Session.create({
    date: d_s2_c1,
    sport: 'Cricket',
    coach: coach._id,
    saved: true,
    savedAt: d_s2_c1,
    locked: true,
    attendance: att_s2_c1,
    initialRosterPlayerIds: att_s2_c1.map(a => a.player),
    createdWithCount: att_s2_c1.length
  });

  const att_s2_c2 = buildSessionAttendance(d_s2_c2, 'Cricket', {
    'Arjun Nair':      { status: 'absent' },
    'Nikhil Saxena':   { status: 'absent' },
    'Varun Malhotra':  { status: 'absent' }
  });
  const s2_c_sess2 = await Session.create({
    date: d_s2_c2,
    sport: 'Cricket',
    coach: coach._id,
    saved: true,
    savedAt: d_s2_c2,
    locked: true,
    attendance: att_s2_c2,
    initialRosterPlayerIds: att_s2_c2.map(a => a.player),
    createdWithCount: att_s2_c2.length
  });

  // Set 2 Cricket Matches
  const crP = set2PlayersBySport.Cricket;
  const s2_c_m1 = await Match.create({
    title: `Cricket Series vs ${set2Config.Cricket.opponents[0]}`,
    sport: 'Cricket',
    date: d_s2_c1,
    time: '10:00',
    opponent: set2Config.Cricket.opponents[0],
    venue: 'Complex Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: s2_c_sess1._id,
    selectedPlayers: [crP[0]._id, crP[1]._id, crP[2]._id, crP[4]._id],
    entries: [
      { player: crP[0]._id, result: 'played', score: 10 },
      { player: crP[1]._id, result: 'played', score: 12 },
      { player: crP[2]._id, result: 'played', score: 8 },
      { player: crP[4]._id, result: 'played', score: 15 }
    ]
  });
  await MatchParticipation.create([
    { match: s2_c_m1._id, player: crP[0]._id, played: true, score: 10, remarks: 'Good opener' },
    { match: s2_c_m1._id, player: crP[1]._id, played: true, score: 12, remarks: 'Solid effort' },
    { match: s2_c_m1._id, player: crP[2]._id, played: true, score: 8,  remarks: 'Only match played' },
    { match: s2_c_m1._id, player: crP[4]._id, played: true, score: 15, remarks: 'First match' }
  ]);

  const s2_c_m2 = await Match.create({
    title: `Cricket Series vs ${set2Config.Cricket.opponents[1]}`,
    sport: 'Cricket',
    date: d_s2_c1,
    time: '15:30',
    opponent: set2Config.Cricket.opponents[1],
    venue: 'Complex Arena',
    status: 'completed',
    coach: coach._id,
    sessionId: s2_c_sess1._id,
    selectedPlayers: [crP[0]._id, crP[1]._id, crP[4]._id],
    entries: [
      { player: crP[0]._id, result: 'played', score: 14 },
      { player: crP[1]._id, result: 'played', score: 11 },
      { player: crP[4]._id, result: 'played', score: 18 }
    ]
  });
  await MatchParticipation.create([
    { match: s2_c_m2._id, player: crP[0]._id, played: true, score: 14, remarks: 'Second match' },
    { match: s2_c_m2._id, player: crP[1]._id, played: true, score: 11, remarks: 'Consistent' },
    { match: s2_c_m2._id, player: crP[4]._id, played: true, score: 18, remarks: 'Second match' }
  ]);

  // ── Original Sessions: Session 1 (Yesterday) & Session 2 (Today) ──
  const yesterday = getDateOffset(1);
  const today = getDateOffset(0);

  const att_sess1 = buildSessionAttendance(yesterday, 'Football', {
    'Aadil Azhar': { status: 'absent' },
    'Sameer Khan': { status: 'absent' }
  });
  const session1 = await Session.create({
    date: yesterday,
    sport: 'Football',
    coach: coach._id,
    saved: true,
    savedAt: yesterday,
    locked: true,
    attendance: att_sess1,
    initialRosterPlayerIds: att_sess1.map(a => a.player),
    createdWithCount: att_sess1.length
  });

  // Match 1 (Yesterday vs Ranchi FC)
  const match1 = await Match.create({
    title: 'Friendly vs Ranchi FC',
    sport: 'Football',
    date: yesterday,
    time: '15:30',
    opponent: 'Ranchi FC',
    venue: 'Morabadi Ground',
    status: 'completed',
    coach: coach._id,
    sessionId: session1._id,
    selectedPlayers: [createdPlayers[0]._id, createdPlayers[1]._id],
    entries: [
      { player: createdPlayers[0]._id, result: 'played', score: 2 }, // Kamran
      { player: createdPlayers[1]._id, result: 'played', score: 1 }  // Krishna
    ]
  });
  await MatchParticipation.create([
    { match: match1._id, player: createdPlayers[0]._id, played: true, score: 2, remarks: 'Two solid goals' },
    { match: match1._id, player: createdPlayers[1]._id, played: true, score: 1, remarks: 'Midfield assist & goal' }
  ]);

  const att_sess2 = buildSessionAttendance(today, 'Football', {
    'Aadil Azhar': { status: 'present', participation: 'match' },
    'Akarsh Raj':  { status: 'absent' },
    'Sameer Khan': { status: 'absent' }
  });
  const session2 = await Session.create({
    date: today,
    sport: 'Football',
    coach: coach._id,
    saved: true,
    savedAt: today,
    locked: true,
    attendance: att_sess2,
    initialRosterPlayerIds: att_sess2.map(a => a.player),
    createdWithCount: att_sess2.length
  });

  // Match 2 (Today vs Jamshedpur United)
  const match2 = await Match.create({
    title: 'State League vs Jamshedpur United',
    sport: 'Football',
    date: today,
    time: '16:00',
    opponent: 'Jamshedpur United',
    venue: 'JRD Tata Complex',
    status: 'completed',
    coach: coach._id,
    sessionId: session2._id,
    selectedPlayers: [createdPlayers[0]._id, createdPlayers[1]._id, createdPlayers[2]._id],
    entries: [
      { player: createdPlayers[0]._id, result: 'played', score: 3 }, // Kamran
      { player: createdPlayers[1]._id, result: 'played', score: 2 }, // Krishna
      { player: createdPlayers[2]._id, result: 'played', score: 1 }  // Aadil
    ]
  });
  await MatchParticipation.create([
    { match: match2._id, player: createdPlayers[0]._id, played: true, score: 3, remarks: 'Top performance' },
    { match: match2._id, player: createdPlayers[1]._id, played: true, score: 2, remarks: 'Controlled tempo' },
    { match: match2._id, player: createdPlayers[2]._id, played: true, score: 1, remarks: 'Scored on debut' }
  ]);

  // ── 5. SUMMARY TABLE & VERIFICATION ──
  console.log('\n========================================================================================');
  console.log('📊 SEEDED PLAYERS SUMMARY TABLE (ALL 24 PLAYERS)');
  console.log('========================================================================================');

  const allPlayersInDb = await Player.find({ coach: coach._id }).sort({ createdAt: 1 });
  const allSessionsInDb = await Session.find({ coach: coach._id });
  const allPartsInDb = await MatchParticipation.find({}).populate('match');

  const summaryRows = [];
  for (const p of allPlayersInDb) {
    const pSessions = allSessionsInDb.filter(s =>
      s.sport === p.sport &&
      (s.attendance || []).some(a => (a.player?._id || a.player).toString() === p._id.toString())
    );
    const totalCount = pSessions.length;
    const presentCount = pSessions.filter(s =>
      (s.attendance || []).some(a => (a.player?._id || a.player).toString() === p._id.toString() && a.status === 'present')
    ).length;
    const attendanceRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

    const parts = allPartsInDb.filter(pt =>
      (pt.player?._id || pt.player)?.toString() === p._id.toString() &&
      pt.match && pt.match.status === 'completed' && pt.played === true
    );
    const matchesPlayed = parts.length;
    const isReady = totalCount > 0 && (attendanceRate >= 75) && (matchesPlayed >= 2);

    let group = 'Original';
    if (['Rohan Mehta', 'Simran Kaur', 'Vivaan Sharma', 'Ananya Singh', 'Arjun Nair'].includes(p.name)) {
      group = 'Set 1 (Named)';
    } else if (set2CreatedPlayers.some(sp => sp.player._id.toString() === p._id.toString())) {
      group = `Set 2 (${p.sport})`;
    }

    summaryRows.push({
      Group: group,
      Username: p.playerId || p.username,
      Name: p.name,
      Sport: p.sport,
      Attendance: `${attendanceRate}% (${presentCount}/${totalCount})`,
      'Matches Played': matchesPlayed,
      'Ready Status': isReady ? '✅ READY' : '❌ NOT READY'
    });
  }

  console.table(summaryRows);

  const totalReady = summaryRows.filter(r => r['Ready Status'].includes('READY') && !r['Ready Status'].includes('NOT')).length;
  console.log(`\nTotal Ready on Scout Radar: ${totalReady} / 24 (Expected: 10)\n`);

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
