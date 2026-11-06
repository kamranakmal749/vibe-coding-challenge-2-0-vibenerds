// scripts/migrate-player-usernames.js
// Idempotent migration to assign permanent unique player IDs (md<YY><sequence>)
// and link/create user accounts with exact matching username.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Player = require('../src/models/Player');
const User = require('../src/models/User');
const { generatePlayerId } = require('../src/utils/idGenerator');

async function migratePlayerUsernames() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas for player username migration');
  }

  // Find all players ordered by registeredOn ascending
  const players = await Player.find().sort({ registeredOn: 1, _id: 1 });
  let assignedCount = 0;
  let linkedUsersCount = 0;

  for (const player of players) {
    let modified = false;
    const isValidFormat = player.playerId && /^md\d{6}$/.test(player.playerId);

    if (!isValidFormat) {
      const newId = await generatePlayerId(player.registeredOn || new Date());
      player.playerId = newId;
      player.username = newId;
      await player.save();
      assignedCount++;
      modified = true;
    } else if (player.username !== player.playerId) {
      player.username = player.playerId;
      await player.save();
      modified = true;
    }

    const assignedId = player.playerId;

    // Link/update User record
    let user = await User.findOne({ playerId: player._id });
    if (!user) {
      user = await User.findOne({ name: player.name, role: 'player' });
      if (user) {
        user.playerId = player._id;
      }
    }

    if (user) {
      if (user.username !== assignedId) {
        user.username = assignedId;
        await user.save();
        linkedUsersCount++;
      }
    } else {
      // Create missing player user account
      await User.create({
        name: player.name,
        username: assignedId,
        email: `${assignedId}@player.com`,
        password: 'player123',
        role: 'player',
        playerId: player._id
      });
      linkedUsersCount++;
    }
  }

  console.log(`✅ Player username migration complete:`);
  console.log(`   • Players assigned new IDs: ${assignedCount}/${players.length}`);
  console.log(`   • Player User accounts linked/synced: ${linkedUsersCount}/${players.length}`);

  return { assignedCount, linkedUsersCount, total: players.length };
}

if (require.main === module) {
  migratePlayerUsernames()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('Migration failed:', err);
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      process.exit(1);
    });
}

module.exports = migratePlayerUsernames;

