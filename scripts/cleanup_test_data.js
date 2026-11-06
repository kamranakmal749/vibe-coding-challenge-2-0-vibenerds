const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const mongoose = require('mongoose');
require('dotenv').config();

const Player = require('../src/models/Player');
const Match = require('../src/models/Match');
const Session = require('../src/models/Session');
const MatchParticipation = require('../src/models/MatchParticipation');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find all test players
  const testPlayers = await Player.find({
    name: { $regex: /^(P1_|P2_|P3_|P4_|Test_|Player_)/i }
  });
  console.log(`Found ${testPlayers.length} test players to delete.`);
  const testPlayerIds = testPlayers.map(p => p._id);

  if (testPlayerIds.length > 0) {
    // Delete participations for these players
    const delPart = await MatchParticipation.deleteMany({ player: { $in: testPlayerIds } });
    console.log(`Deleted ${delPart.deletedCount} match participations for test players.`);

    // Delete matches that were created for these test runs
    const delMatches = await Match.deleteMany({
      $or: [
        { title: { $regex: /League Match \d+|Time-Based Test|Match_/i } },
        { opponent: { $regex: /Rival FC \d+|Test Opponent/i } }
      ]
    });
    console.log(`Deleted ${delMatches.deletedCount} test matches.`);

    // Delete test sessions
    const delSessions = await Session.deleteMany({
      $or: [
        { title: { $regex: /Training_\d+|Test Session|Session_/i } },
        { 'attendance.player': { $in: testPlayerIds } }
      ]
    });
    console.log(`Deleted ${delSessions.deletedCount} test sessions.`);

    // Delete test players
    const delPlayers = await Player.deleteMany({ _id: { $in: testPlayerIds } });
    console.log(`Deleted ${delPlayers.deletedCount} test players.`);
  }

  // Check remaining football players
  const footballPlayers = await Player.find({ sport: 'Football' }).sort({ createdAt: 1 });
  console.log(`\nRemaining Football Players count: ${footballPlayers.length}`);
  footballPlayers.forEach((p, idx) => {
    console.log(`${idx + 1}. ${p.name} (ID: ${p._id})`);
  });

  const totalPlayers = await Player.countDocuments();
  console.log(`Total players across all sports: ${totalPlayers}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

