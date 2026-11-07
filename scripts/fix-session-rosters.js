// scripts/fix-session-rosters.js
// Migration & Audit Script: detects and removes retroactively injected players
// from session attendance arrays.
//
// Detection Hierarchy:
// 1. EXACT SNAPSHOT (if session.initialRosterPlayerIds is present):
//    Compares current attendance.player against initialRosterPlayerIds snapshotted at creation.
//    Any player NOT in initialRosterPlayerIds is definitely retroactively injected.
//
// 2. CREATION TIMESTAMP HEURISTIC (for legacy sessions lacking initialRosterPlayerIds):
//    If a player was created in MongoDB after the session was created (player.createdAt > session.createdAt),
//    they physically could not have existed when POST /api/sessions was originally called.
//
// 3. REGISTRATION DATE HEURISTIC:
//    If player.registeredOn > session.date.
//
// Run: node scripts/fix-session-rosters.js [--dry-run]

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Session = require('../legacy/src/models/Session');
const Player = require('../legacy/src/models/Player');
const User = require('../legacy/src/models/User');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB. ${DRY_RUN ? '[DRY RUN — audit only, no writes]' : '[LIVE — will modify sessions]'}`);

  const sessions = await Session.find({})
    .populate('attendance.player', 'name registeredOn sport createdAt')
    .populate('coach', 'name email');

  let totalFixed = 0;
  let totalRemoved = 0;

  for (const session of sessions) {
    const sessionDate = new Date(session.date);
    const sessionCreatedAt = session.createdAt || session._id.getTimestamp();
    const before = session.attendance.length;

    const hasExactSnapshot = Array.isArray(session.initialRosterPlayerIds) && session.initialRosterPlayerIds.length > 0;
    const exactIds = hasExactSnapshot
      ? new Set(session.initialRosterPlayerIds.map(id => id.toString()))
      : null;

    // Detect injected entries
    const injected = [];
    for (const a of session.attendance) {
      const p = a.player;
      if (!p) continue;
      const pId = p._id ? p._id.toString() : a.player.toString();

      if (hasExactSnapshot) {
        // Mode 1: Deterministic check against creation snapshot
        if (!exactIds.has(pId)) {
          injected.push({
            player: p,
            status: a.status,
            reason: 'EXACT: Not present in session.initialRosterPlayerIds snapshot'
          });
        }
      } else {
        // Mode 2 & 3: Best-effort heuristics for legacy sessions
        const pCreatedAt = p.createdAt || p._id.getTimestamp();
        if (pCreatedAt && sessionCreatedAt && pCreatedAt > new Date(sessionCreatedAt.getTime() + 5000)) {
          injected.push({
            player: p,
            status: a.status,
            reason: `TIMESTAMP: Player created (${pCreatedAt.toISOString()}) after session created (${sessionCreatedAt.toISOString()})`
          });
        } else if (p.registeredOn && new Date(p.registeredOn) > sessionDate) {
          injected.push({
            player: p,
            status: a.status,
            reason: `DATE: Player registeredOn (${new Date(p.registeredOn).toISOString().split('T')[0]}) > session.date (${sessionDate.toISOString().split('T')[0]})`
          });
        }
      }
    }

    if (injected.length === 0) continue;

    console.log(`\n[FLAGGED] Session: ${sessionDate.toISOString().split('T')[0]} | ${session.sport} | Coach: ${session.coach?.email || session.coach}`);
    console.log(`  Strategy: ${hasExactSnapshot ? 'EXACT SNAPSHOT' : 'BEST-EFFORT HEURISTIC (Legacy session)'}`);
    for (const item of injected) {
      console.log(`  REMOVE: ${item.player.name} | Status: ${item.status} | Reason: ${item.reason}`);
    }

    const injectedIds = new Set(injected.map(i => (i.player._id || i.player).toString()));

    if (!DRY_RUN) {
      session.attendance = session.attendance.filter(a => {
        const id = (a.player?._id || a.player).toString();
        return !injectedIds.has(id);
      });
      await session.save();
      console.log(`  ✅ Roster: ${before} -> ${session.attendance.length} (removed ${before - session.attendance.length})`);
    } else {
      console.log(`  [DRY RUN] Would shrink roster: ${before} -> ${before - injected.length}`);
    }

    totalFixed++;
    totalRemoved += injected.length;
  }

  console.log(`\n======================================================`);
  if (DRY_RUN) {
    console.log(`[AUDIT SUMMARY] Found ${totalFixed} sessions with ${totalRemoved} retroactively-injected player entries.`);
  } else {
    console.log(`Fixed ${totalFixed} sessions, removed ${totalRemoved} retroactively-injected player entries.`);
  }
  console.log(`======================================================\n`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
