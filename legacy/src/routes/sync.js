// src/routes/sync.js
// Centralized real-time server-sent events (SSE) hub and state synchronization
const express = require('express');
const router = express.Router();

// Active SSE client connections
const clients = new Set();
let currentVersion = Date.now();

// ── GET /api/sync/stream ──────────────────────────────────────────
// SSE endpoint for multi-session and cross-browser real-time updates
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial connection acknowledgement
  res.write(`data: ${JSON.stringify({ type: 'connected', version: currentVersion, timestamp: Date.now() })}\n\n`);

  clients.add(res);

  // Keep-alive heartbeat every 20 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (_) {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ── GET /api/sync/version ─────────────────────────────────────────
// Lightweight polling fallback endpoint for environments where SSE might be blocked
router.get('/version', (_req, res) => {
  res.json({ version: currentVersion, clientsCount: clients.size });
});

/**
 * Broadcast an event to all connected SSE clients across any browser or device.
 * @param {Object} event - { entity: string, action: string, entityId?: string, extra?: Object }
 */
function broadcastServerSync(event) {
  currentVersion = Date.now();
  const payload = {
    ...event,
    version: currentVersion,
    timestamp: Date.now()
  };

  const message = `data: ${JSON.stringify(payload)}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch (_) {
      clients.delete(client);
    }
  }
}

module.exports = router;
module.exports.broadcastServerSync = broadcastServerSync;

