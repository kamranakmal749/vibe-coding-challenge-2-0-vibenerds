// scripts/migrate-v2.js
// Idempotent migration to v2 MaidanDesk schema rules:
//   1. Sessions with locked: true become saved: true with savedAt set.
//   2. Attendance entries get participation: player.defaultParticipation (or 'both'); absent get null.
//   3. Players without registeredOn get migration date; players without defaultParticipation get 'both'.
//   4. Matches with old scores are converted to entries: { player, result: 'played', score }.
// Run: node scripts/migrate-v2.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Player   = require('../src/models/Player');
const Session  = require('../src/models/Session');
const Match    = require('../src/models/Match');

async function migrate() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas for v2 migration');
  }

  const migrationDate = new Date();
  let playersUpdated = 0;
  let sessionsUpdated = 0;
  let matchesUpdated = 0;

  // 1. Migrate Players: registeredOn & defaultParticipation
  const players = await Player.find();
  const playerMap = new Map();

  for (const player of players) {
    let modified = false;
    if (!player.registeredOn) {
      player.registeredOn = migrationDate;
      modified = true;
    }
    if (!player.defaultParticipation || !['practice', 'match', 'both'].includes(player.defaultParticipation)) {
      player.defaultParticipation = 'both';
      modified = true;
    }
    if (modified) {
      await player.save();
      playersUpdated++;
    }
    playerMap.set(player._id.toString(), player);
  }
  console.log(`✅ Players migrated: ${playersUpdated}/${players.length}`);

  // 2. Migrate Sessions: locked -> saved, attendance.participation
  const sessions = await Session.find();
  for (const session of sessions) {
    let modified = false;

    // Convert locked to saved
    if (session.locked && !session.saved) {
      session.saved = true;
      if (!session.savedAt) session.savedAt = session.updatedAt || migrationDate;
      modified = true;
    }

    if (session.saved && !session.savedAt) {
      session.savedAt = session.updatedAt || migrationDate;
      modified = true;
    }

    // Attendance participation
    if (Array.isArray(session.attendance)) {
      for (const entry of session.attendance) {
        if (entry.status === 'absent') {
          if (entry.participation !== null) {
            entry.participation = null;
            modified = true;
          }
        } else {
          // Status is present
          if (!entry.participation || !['practice', 'match', 'both'].includes(entry.participation)) {
            const p = playerMap.get((entry.player?._id || entry.player)?.toString());
            entry.participation = p?.defaultParticipation || 'both';
            modified = true;
          }
        }
      }
    }

    if (modified) {
      await session.save();
      sessionsUpdated++;
    }
  }
  console.log(`✅ Sessions migrated: ${sessionsUpdated}/${sessions.length}`);

  // 3. Migrate Matches: scores -> entries
  // Use native collection or document inspection so legacy scores field is accessible
  const rawMatches = await mongoose.connection.collection('matches').find().toArray();
  for (const rawMatch of rawMatches) {
    let modified = false;
    const existingEntries = Array.isArray(rawMatch.entries) ? rawMatch.entries : [];

    if (existingEntries.length === 0 && Array.isArray(rawMatch.scores) && rawMatch.scores.length > 0) {
      const convertedEntries = rawMatch.scores.map(s => ({
        player: s.player,
        result: 'played',
        score: typeof s.score === 'number' ? s.score : 0
      }));

      await mongoose.connection.collection('matches').updateOne(
        { _id: rawMatch._id },
        { 
          $set: { entries: convertedEntries },
          $unset: { scores: "" }
        }
      );
      matchesUpdated++;
    }
  }
  console.log(`✅ Matches migrated: ${matchesUpdated}/${rawMatches.length}`);

  console.log('\nMigration to v2 completed successfully (Idempotent).');
}

if (require.main === module) {
  migrate().then(async () => {
    await mongoose.disconnect();
  }).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = migrate;
