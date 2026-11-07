// scripts/verify-academy-final.js
// Read-only integrity and verification script for academy_final
require('dns').setServers(['8.8.8.8', '1.1.1.1']);

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

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

async function verify() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('FATAL: MONGODB_URI is not set.');
    process.exit(1);
  }

  const dbName = extractDbName(uri);
  const maskedUri = maskUri(uri);

  console.log('================================================================');
  console.log('🔍 ACADEMY_FINAL READ-ONLY INTEGRITY VERIFICATION');
  console.log('================================================================');
  console.log(`Database Name: ${dbName}`);
  console.log(`Connection URI: ${maskedUri}\n`);

  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  // 1. Collection Counts
  const usersColl = db.collection('users');
  const playersColl = db.collection('players');
  const sessionsColl = db.collection('sessions');
  const matchesColl = db.collection('matches');
  const participationsColl = db.collection('matchparticipations');
  const countersColl = db.collection('counters');

  const [
    userCount,
    playerCount,
    sessionCount,
    matchCount,
    partCount,
    counterCount,
  ] = await Promise.all([
    usersColl.countDocuments(),
    playersColl.countDocuments(),
    sessionsColl.countDocuments(),
    matchesColl.countDocuments(),
    participationsColl.countDocuments(),
    countersColl.countDocuments(),
  ]);

  console.log('📊 COLLECTION COUNTS:');
  console.log(`  • Users:                ${userCount}  (Expected: 27)`);
  console.log(`  • Players:              ${playerCount}  (Expected: 24)`);
  console.log(`  • Sessions:             ${sessionCount}  (Expected: 14)`);
  console.log(`  • Matches:              ${matchCount}  (Expected: 13)`);
  console.log(`  • MatchParticipations:  ${partCount}  (Expected: 33)`);
  console.log(`  • Counters:             ${counterCount}\n`);

  // Fetch all documents for reference checks
  const [allUsers, allPlayers, allSessions, allMatches, allParts] = await Promise.all([
    usersColl.find({}).toArray(),
    playersColl.find({}).toArray(),
    sessionsColl.find({}).toArray(),
    matchesColl.find({}).toArray(),
    participationsColl.find({}).toArray(),
  ]);

  const playerIdSet = new Set(allPlayers.map(p => p._id.toString()));
  const playerCustomIdSet = new Set(allPlayers.map(p => p.playerId).filter(Boolean));
  const matchIdSet = new Set(allMatches.map(m => m._id.toString()));

  // 2. Link Integrity Check 1: player-role users with missing player
  // Users link to players via users.playerId
  const playerUsers = allUsers.filter(u => u.role === 'player');
  const missingPlayerUsers = playerUsers.filter(u => {
    if (!u.playerId) return true;
    const matchesObjId = playerIdSet.has(u.playerId.toString());
    const matchesCustomId = playerCustomIdSet.has(u.playerId);
    return !matchesObjId && !matchesCustomId;
  });

  // 3. Link Integrity Check 2: duplicate playerIds
  const playerCustomIds = allPlayers.map(p => p.playerId).filter(Boolean);
  const dupPlayerIds = playerCustomIds.filter((id, i) => playerCustomIds.indexOf(id) !== i);

  // 4. Link Integrity Check 3: attendance entries with missing player
  let orphanAttendanceCount = 0;
  for (const s of allSessions) {
    for (const a of s.attendance || []) {
      const pid = (a.player?._id || a.player)?.toString();
      if (!pid || !playerIdSet.has(pid)) {
        orphanAttendanceCount++;
      }
    }
  }

  // 5. Link Integrity Check 4: selectedPlayers with missing player
  let orphanSelectedPlayersCount = 0;
  for (const m of allMatches) {
    for (const sp of m.selectedPlayers || []) {
      const pid = (sp?._id || sp)?.toString();
      if (!pid || !playerIdSet.has(pid)) {
        orphanSelectedPlayersCount++;
      }
    }
  }

  // 6. Link Integrity Check 5: participations with missing match or player
  let orphanPartsMatch = 0;
  let orphanPartsPlayer = 0;
  for (const pt of allParts) {
    const mid = (pt.match?._id || pt.match)?.toString();
    const pid = (pt.player?._id || pt.player)?.toString();
    if (!mid || !matchIdSet.has(mid)) orphanPartsMatch++;
    if (!pid || !playerIdSet.has(pid)) orphanPartsPlayer++;
  }

  console.log('🔗 LINK-INTEGRITY CHECKS (Must be 0 violations):');
  console.log(`  1. Player-role users with missing player:    ${missingPlayerUsers.length} violations`);
  console.log(`  2. Duplicate playerIds in player collection: ${dupPlayerIds.length} violations`);
  console.log(`  3. Attendance entries with missing player:   ${orphanAttendanceCount} violations`);
  console.log(`  4. SelectedPlayers with missing player:      ${orphanSelectedPlayersCount} violations`);
  console.log(`  5. Participations with missing match:       ${orphanPartsMatch} violations`);
  console.log(`  6. Participations with missing player:      ${orphanPartsPlayer} violations\n`);

  // 7. Scout Readiness Count (Spec: 10 READY / 14 NOT READY)
  let readyCount = 0;
  for (const p of allPlayers) {
    const playerSessions = allSessions.filter(s =>
      s.sport === p.sport &&
      (s.attendance || []).some(a => (a.player?._id || a.player)?.toString() === p._id.toString())
    );
    const totalSessions = playerSessions.length;
    const presentSessions = playerSessions.filter(s =>
      (s.attendance || []).some(
        a => (a.player?._id || a.player)?.toString() === p._id.toString() && a.status === 'present'
      )
    ).length;
    const attRate = totalSessions > 0 ? (presentSessions / totalSessions) * 100 : 0;

    const matchesPlayed = allParts.filter(
      pt => (pt.player?._id || pt.player)?.toString() === p._id.toString() && pt.played === true
    ).length;

    const isReady = attRate >= 75 && matchesPlayed >= 2;
    if (isReady) readyCount++;
  }

  console.log(`⭐ SCOUT RADAR READINESS COUNT:`);
  console.log(`  • Ready Players:     ${readyCount}  (Expected: 10)`);
  console.log(`  • Not Ready Players: ${allPlayers.length - readyCount}  (Expected: 14)\n`);

  const hasErrors =
    missingPlayerUsers.length > 0 ||
    dupPlayerIds.length > 0 ||
    orphanAttendanceCount > 0 ||
    orphanSelectedPlayersCount > 0 ||
    orphanPartsMatch > 0 ||
    orphanPartsPlayer > 0 ||
    userCount !== 27 ||
    playerCount !== 24 ||
    sessionCount !== 14 ||
    matchCount !== 13 ||
    partCount !== 33 ||
    readyCount !== 10;

  if (hasErrors) {
    console.error('❌ VERIFICATION FAILED: Discrepancies detected against target schema requirements.');
    await mongoose.disconnect();
    process.exit(1);
  } else {
    console.log('✅ ALL INTEGRITY AND COUNT CHECKS PASSED PERFECTLY (0 VIOLATIONS).');
    await mongoose.disconnect();
    process.exit(0);
  }
}

verify().catch(err => {
  console.error('FATAL verification error:', err);
  process.exit(1);
});

