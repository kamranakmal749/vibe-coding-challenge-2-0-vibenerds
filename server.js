// server.js - Maidan Desk API Entry Point
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 3000;

// Start Express server immediately so UI and static files are always accessible
const server = app.listen(PORT, () => {
  console.log(`🏟️  Maidan Desk running on http://localhost:${PORT}`);
});

// Connect to MongoDB Atlas in the background
connectDB()
  .then(() => {
    console.log('✅  MongoDB Atlas connection established.');
  })
  .catch(err => {
    console.error('⚠️  MongoDB connection warning:', err.message);
    console.log('ℹ️  If port 27017 or DNS is blocked on campus Wi-Fi, switch to mobile hotspot to sync live data.');
  });


