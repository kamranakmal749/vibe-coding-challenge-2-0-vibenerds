// scripts/cleanup-orphaned-match-entries.js
// Maintenance & Migration Script: finds and cleans up dangling references to
// deleted players in Match.entries, Match.selectedPlayers, and MatchParticipation.
//
// Usage: node scripts/cleanup-orphaned-match-entries.js [--dry-run]

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Match = require('../src/models/Match');
const Player = require('../src/models/Player');
const MatchParticipation = require('../src/models/MatchParticipation');

const DRY_RUN = process.argv.includes('--dry-run');

async function cleanupOrphanedMatchEntries() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB Atlas. Mode: ${DRY_RUN ? '[DRY RUN - No writes]' : '[LIVE - Performing cleanup]'}`);

  const livePlayers = await Player.find({}, '_id name').lean();
  const livePlayerIds = new Set(livePlayers.map(p => p._id.toString()));
  console.log(`Live Player Documents: ${livePlayers.length}`);

  const matches = await Match.find({});
  let orphanedEntriesRemoved = 0;
  let orphanedSelectedRemoved = 0;
  let modifiedMatches = 0;

  for (const m of matches) {
    let matchModified = false;
    const initialEntriesCount = (m.entries || []).length;
    const initialSelectedCount = (m.selectedPlayers || []).length;

    // Filter entries
    const cleanEntries = (m.entries || []).filter(e => {
      const pid = (e.player?._id || e.player)?.toString();
      const exists = livePlayerIds.has(pid);
      if (!exists) orphanedEntriesRemoved++;
      return exists;
    });

    // Filter selectedPlayers
    const cleanSelected = (m.selectedPlayers || []).filter(sp => {
      const pid = (sp?._id || sp)?.toString();
      const exists = livePlayerIds.has(pid);
      if (!exists) orphanedSelectedRemoved++;
      return exists;
    });

    if (cleanEntries.length !== initialEntriesCount || cleanSelected.length !== initialSelectedCount) {
      matchModified = true;
      modifiedMatches++;
      console.log(`[MATCH] "${m.title}" (${m._id}) had orphans: entries ${initialEntriesCount} -> ${cleanEntries.length}, selected ${initialSelectedCount} -> ${cleanSelected.length}`);
      if (!DRY_RUN) {
        m.entries = cleanEntries;
        m.selectedPlayers = cleanSelected;
        await m.save();
      }
    }
  }

  // Cleanup orphaned MatchParticipation records
  const allParticipations = await MatchParticipation.find({});
  const orphanedParticipationIds = allParticipations
    .filter(pt => !livePlayerIds.has((pt.player?._id || pt.player)?.toString()))
    .map(pt => pt._id);

  console.log(`\n--- Orphan Cleanup Summary ---`);
  console.log(`Matches modified: ${modifiedMatches}`);
  console.log(`Orphaned entries stripped: ${orphanedEntriesRemoved}`);
  console.log(`Orphaned selectedPlayers stripped: ${orphanedSelectedRemoved}`);
  console.log(`Orphaned MatchParticipation rows found: ${orphanedParticipationIds.length}`);

  if (orphanedParticipationIds.length > 0 && !DRY_RUN) {
    const res = await MatchParticipation.deleteMany({ _id: { $in: orphanedParticipationIds } });
    console.log(`Deleted ${res.deletedCount} orphaned MatchParticipation records.`);
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] No database writes were performed.`);
  } else {
    console.log(`\n✅ Database cleaned successfully.`);
  }

  await mongoose.disconnect();
}

cleanupOrphanedMatchEntries().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});

