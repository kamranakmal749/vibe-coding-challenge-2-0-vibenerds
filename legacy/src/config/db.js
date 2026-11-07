// src/config/db.js - MongoDB Atlas connection
const mongoose = require('mongoose');
const dns = require('dns');

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (_) {}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅  MongoDB Atlas connected');
  } catch (err) {
    console.error('⚠️  MongoDB connection warning:', err.message);
    console.log('ℹ️  Server will remain running. To sync live database data:');
    console.log('    1. Switch to mobile hotspot (campus Wi-Fi blocks port 27017 or DNS).');
    console.log('    2. Verify 0.0.0.0/0 is whitelisted in your Atlas Network Access tab.');
    // Do not call process.exit(1) so the dev server and frontend remain active
  }
}

module.exports = connectDB;

