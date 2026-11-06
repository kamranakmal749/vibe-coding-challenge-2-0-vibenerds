// scripts/verify-player-links.js
// Integrity check for unique player IDs (md<YY><sequence>), username links,
// absence of orphaned references, and full attendance/match stats reconciliation.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Player = require('../src/models/Player');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Match = require('../src/models/Match');
const MatchParticipation = require('../src/models/MatchParticipation');
const { enrichPlayer } = require('../src/routes/players');

async function verifyPlayerLinks() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas for integrity verification');
  }

  const players = await Player.find().sort({ registeredOn: 1, _id: 1 });
  const users = await User.find();
  const sessions = await Session.find();
  const matches = await Match.find();
  const participations = await MatchParticipation.find().populate('match');

  console.log(`\n======================================================`);
  console.log(`🔍 RUNNING PLAYER LINKS & DATA RECONCILIATION AUDIT`);
  console.log(`   Players: ${players.length} | Users: ${users.length} | Sessions: ${sessions.length} | Matches: ${matches.length}`);
  console.log(`======================================================\n`);

  let failures = [];

  // 1. Every Player has valid unique username/playerId (format md<YY><sequence>)
  console.log('--- 1. Valid Player ID format check (/^md\\d{6}$/) ---');
  const playerIdSet = new Set();
  for (const p of players) {
    const id = p.playerId || p.username;
    if (!id || !/^md\d{6}$/.test(id)) {
      failures.push(`Player "${p.name}" (${p._id}) has invalid playerId format: "${id}" (expected /^md\\d{6}$/)`);
    }
    if (playerIdSet.has(id)) {
      failures.push(`Duplicate playerId detected: "${id}" on player "${p.name}" (${p._id})`);
    }
    playerIdSet.add(id);
  }
  if (!failures.length) {
    console.log(`✓ All ${players.length} players have valid, unique permanent playerIds (e.g. ${players[0]?.playerId}).`);
  }

  // 2. Every player-role User matches linked Player exactly
  console.log('\n--- 2. User-Player link and exact username match check ---');
  const playerUsers = users.filter(u => u.role === 'player');
  const playerMap = new Map(players.map(p => [p._id.toString(), p]));

  for (const u of playerUsers) {
    if (!u.playerId) {
      failures.push(`User "${u.name}" (${u.email}) with role 'player' has null/missing playerId!`);
      continue;
    }
    const linkedPlayer = playerMap.get(u.playerId.toString());
    if (!linkedPlayer) {
      failures.push(`User "${u.name}" references non-existent Player _id: ${u.playerId}`);
      continue;
    }
    const expectedUsername = linkedPlayer.playerId || linkedPlayer.username;
    if (u.username !== expectedUsername) {
      failures.push(`User username mismatch for player "${linkedPlayer.name}": user.username="${u.username}" vs player.playerId="${expectedUsername}"`);
    }
  }
  if (!failures.length) {
    console.log(`✓ All ${playerUsers.length} player user accounts match their linked Player document username exactly.`);
  }

  // 3. Check for orphaned references
  console.log('\n--- 3. Orphaned references check ---');
  const validPlayerObjIds = new Set(players.map(p => p._id.toString()));

  // In Sessions
  for (const s of sessions) {
    for (const a of (s.attendance || [])) {
      const pid = (a.player?._id || a.player)?.toString();
      if (!validPlayerObjIds.has(pid)) {
        failures.push(`Session ${s._id} (${s.sport}, ${s.date}) contains orphaned player ID: ${pid}`);
      }
    }
  }

  // In MatchParticipation
  for (const pt of participations) {
    const pid = (pt.player?._id || pt.player)?.toString();
    if (!validPlayerObjIds.has(pid)) {
      failures.push(`MatchParticipation ${pt._id} contains orphaned player ID: ${pid}`);
    }
    if (!pt.match) {
      failures.push(`MatchParticipation ${pt._id} has null match reference!`);
    }
  }

  // In Matches
  for (const m of matches) {
    for (const sel of (m.selectedPlayers || [])) {
      const pid = (sel?._id || sel)?.toString();
      if (!validPlayerObjIds.has(pid)) {
        failures.push(`Match ${m._id} selectedPlayers contains orphaned player ID: ${pid}`);
      }
    }
    for (const e of (m.entries || [])) {
      const pid = (e.player?._id || e.player)?.toString();
      if (!validPlayerObjIds.has(pid)) {
        failures.push(`Match ${m._id} entries contains orphaned player ID: ${pid}`);
      }
    }
  }
  if (!failures.length) {
    console.log('✓ Zero orphaned references found across Sessions, Matches, and Participations.');
  }

  // 4. Re-verify attendance/matches stats reconcile with raw data (Hand-Calc vs Enriched)
  console.log('\n--- 4. Full Attendance & Match Stats Hand-Calculation Reconciliation ---');
  const reconciliationRows = [];

  for (const p of players) {
    const pid = p._id.toString();

    // Hand attendance calculation
    const inSessions = sessions.filter(s => (s.attendance || []).some(a => (a.player?._id || a.player)?.toString() === pid));
    const presentSessions = inSessions.filter(s => {
      const entry = (s.attendance || []).find(a => (a.player?._id || a.player)?.toString() === pid);
      return entry && entry.status === 'present';
    });
    const handAttRate = inSessions.length > 0 ? Math.round((presentSessions.length / inSessions.length) * 100) : 0;

    // Hand matches played calculation
    const parts = participations.filter(pt => (pt.player?._id || pt.player)?.toString() === pid && pt.match && pt.match.status === 'completed' && pt.played === true);
    const handMatchesPlayed = parts.length;
    const handIsReady = inSessions.length > 0 && (presentSessions.length * 4 >= inSessions.length * 3) && (handMatchesPlayed >= 2);

    // Enriched API calculation
    const enriched = await enrichPlayer(p);

    const attMatch = handAttRate === enriched.attendanceRate && presentSessions.length === enriched.presentSessions && inSessions.length === enriched.totalSessions;
    const matchMatch = handMatchesPlayed === enriched.matchesPlayed;
    const readyMatch = handIsReady === enriched.isReady;

    if (!attMatch || !matchMatch || !readyMatch) {
      failures.push(`Stats desync on player "${p.name}" (${p.playerId}): Hand[${handAttRate}%, ${handMatchesPlayed}m, ready=${handIsReady}] vs Enriched[${enriched.attendanceRate}%, ${enriched.matchesPlayed}m, ready=${enriched.isReady}]`);
    }

    reconciliationRows.push({
      Username: p.playerId,
      Name: p.name,
      Sport: p.sport,
      Attendance: `${handAttRate}% (${presentSessions.length}/${inSessions.length})`,
      'Matches Played': handMatchesPlayed,
      'Ready Status': handIsReady ? '✅ READY' : '❌ NOT READY',
      Reconciled: (attMatch && matchMatch && readyMatch) ? '✅ PASS' : '❌ FAIL'
    });
  }

  console.table(reconciliationRows);

  // Specific check for Kamran Akmal
  console.log('\n--- 5. Specific Verification for Kamran Akmal ---');
  const kamran = players.find(p => p.name === 'Kamran Akmal');
  if (!kamran) {
    failures.push('Kamran Akmal not found in database!');
  } else {
    const kamranEnriched = await enrichPlayer(kamran);
    console.log(`👤 Name: ${kamran.name}`);
    console.log(`🆔 Username / Player ID: ${kamran.playerId}`);
    console.log(`📊 Attendance %: ${kamranEnriched.attendanceRate}% (${kamranEnriched.presentSessions}/${kamranEnriched.totalSessions})`);
    console.log(`⚽ Matches Played: ${kamranEnriched.matchesPlayed}`);
    console.log(`🌟 Ready Status: ${kamranEnriched.isReady ? 'READY (PASS)' : 'NOT READY (FAIL)'}`);

    if (kamranEnriched.attendanceRate !== 100 || kamranEnriched.matchesPlayed !== 2 || !kamranEnriched.isReady) {
      failures.push(`Kamran Akmal numbers mismatch! Expected 100%, 2 matches, READY. Got ${kamranEnriched.attendanceRate}%, ${kamranEnriched.matchesPlayed} matches, ready=${kamranEnriched.isReady}`);
    }
  }

  if (failures.length > 0) {
    console.error('\n❌ INTEGRITY AUDIT FAILED with errors:');
    failures.forEach(f => console.error('   • ' + f));
    throw new Error(`Integrity check failed with ${failures.length} issues.`);
  }

  console.log('\n======================================================');
  console.log('🎉 ALL INTEGRITY & RECONCILIATION CHECKS PASSED CLEANLY (0 ISSUES)');
  console.log('======================================================\n');
}

if (require.main === module) {
  verifyPlayerLinks()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error(err.message);
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      process.exit(1);
    });
}

module.exports = verifyPlayerLinks;

