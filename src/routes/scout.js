// src/routes/scout.js
// Scout can only see players who meet the "Ready" criteria:
//   • Attendance ≥ 75%  (presentCount * 4 >= totalCount * 3)
//   • Matches played   ≥ 2
const router  = require('express').Router();
const Player  = require('../models/Player');
const { enrichPlayer } = require('./players');
const { authenticate, allow } = require('../middleware/auth');

router.use(authenticate, allow('admin', 'scout'));

// ── GET /api/scout/ready  – list all Ready players ───────────
router.get('/ready', async (req, res) => {
  try {
    const allPlayers = await Player.find().populate('coach', 'name');
    const enriched = await Promise.all(allPlayers.map(enrichPlayer));
    const readyPlayers = enriched.filter(p => p.isReady);
    res.json(readyPlayers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
