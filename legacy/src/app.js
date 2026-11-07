// src/app.js - Express App Setup
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes    = require('./routes/auth');
const playerRoutes  = require('./routes/players');
const sessionRoutes = require('./routes/sessions');
const matchRoutes   = require('./routes/matches');
const scoutRoutes   = require('./routes/scout');
const syncRoutes    = require('./routes/sync');

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir)); // Serve index.html from legacy/public

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/players',  playerRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/matches',  matchRoutes);
app.use('/api/scout',    scoutRoutes);
app.use('/api/sync',     syncRoutes);

// ── Health Check ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Catch-all: return SPA ─────────────────────────────────────
app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: publicDir }));

module.exports = app;
