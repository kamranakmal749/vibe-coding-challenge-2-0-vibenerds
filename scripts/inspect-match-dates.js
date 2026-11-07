require('dotenv').config();
const mongoose = require('mongoose');
const Match = require('../legacy/src/models/Match');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB:', mongoose.connection.name);
  const matches = await Match.find().limit(10).lean();
  matches.forEach((m, i) => {
    console.log(`Match ${i+1}:`);
    console.log(`  _id:   ${m._id}`);
    console.log(`  title: ${m.title}`);
    console.log(`  date:  ${m.date instanceof Date ? m.date.toISOString() : m.date}`);
    console.log(`  time:  ${m.time}`);
  });
  await mongoose.disconnect();
}
run().catch(console.error);
