// src/routes/audit.js
// Admin-only audit log inspection
const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { authenticate, allow } = require('../middleware/auth');

router.use(authenticate);
router.use(allow('admin'));

// ── GET /api/audit-logs ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.action) {
      filter.action = req.query.action;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      logs,
      total,
      page,
      limit
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch audit logs' });
  }
});

// ── GET /api/audit-logs/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const log = await AuditLog.findById(req.params.id).lean();
    if (!log) return res.status(404).json({ error: 'Audit log entry not found' });
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
