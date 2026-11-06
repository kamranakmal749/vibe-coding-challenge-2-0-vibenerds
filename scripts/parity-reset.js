// scripts/parity-reset.js
// Safe database cleanup script exclusively for the academy_parity test database.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || '';

// Strict database safety guard
if (!/\/academy_parity\?/.test(uri) && !/\/academy_parity$/.test(uri)) {
  console.error('❌ SAFETY ABORT: MONGODB_URI does not target academy_parity!');
  console.error('Found URI targeting a different database. Parity reset only permitted on /academy_parity.');
  process.exit(1);
}

async function resetParityDb() {
  console.log('Connecting to academy_parity database for test fixture reset...');
  await mongoose.connect(uri);

  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const col of collections) {
    if (!col.name.startsWith('system.')) {
      await mongoose.connection.db.collection(col.name).deleteMany({});
      console.log(`  🧹 Cleared collection: ${col.name}`);
    }
  }

  console.log('✅ academy_parity database successfully reset.');
  await mongoose.disconnect();
}

if (require.main === module) {
  resetParityDb().catch(err => {
    console.error('Parity reset failed:', err);
    process.exit(1);
  });
}

module.exports = resetParityDb;

