// src/routes/sessions.js
const router  = require('express').Router();
const Session = require('../models/Session');
const Player  = require('../models/Player');
const { authenticate, allow } = require('../middleware/auth');
const { resolveCoachId } = require('../utils/coach');
const { sportRegex } = require('../utils/sport');
const { syncSessionMatchConflicts } = require('../services/statsService');
const { broadcastServerSync } = require('./sync');

router.use(authenticate);

// ── Draft roster synchronization ─────────────────────────────
// A draft session is mutable. Keep its roster aligned with every player the
// coach currently has in that sport. Saved sessions are snapshots and are
// deliberately never changed here.
async function syncDraftRoster(session) {
  if (!session || session.saved || session.locked) return session;

  let changed = false;

  // Ensure initialRosterPlayerIds snapshot is initialized
  if (!session.initialRosterPlayerIds || session.initialRosterPlayerIds.length === 0) {
    const coachId = session.coach?._id || session.coach;
    const players = await Player.find({
      coach: coachId,
      sport: sportRegex(session.sport)
    }).select('_id');

    session.initialRosterPlayerIds = players.map(p => p._id);
    session.createdWithCount = session.initialRosterPlayerIds.length;
    changed = true;
  }

  if (changed) {
    await session.save();
  }

  return session;
}

// Merge a client attendance payload into the roster. Unknown player
// IDs are rejected, and omitted roster players default to present instead of being
// silently dropped when the register is saved.
async function mergeAttendancePayload(session, attendance) {
  const updates = new Map();
  const seen = new Set();

  if (Array.isArray(attendance)) {
    for (const item of attendance) {
      const playerId = (item.playerId || item.player?._id || item.player)?.toString();
      if (!playerId) continue;
      if (seen.has(playerId)) {
        const err = new Error('Duplicate attendance record for the same player in this session');
        err.status = 400;
        throw err;
      }
      seen.add(playerId);
      updates.set(playerId, item);
    }
  }

  const coachId = session.coach?._id || session.coach;

  const rosterIds = new Set(
    (session.initialRosterPlayerIds && session.initialRosterPlayerIds.length > 0
      ? session.initialRosterPlayerIds
      : (session.attendance || []).map(a => a.player)
    ).map(p => (p?._id || p)?.toString()).filter(Boolean)
  );

  if (coachId) {
    const activePlayers = await Player.find({
      coach: coachId,
      sport: sportRegex(session.sport)
    }).select('_id');
    activePlayers.forEach(p => rosterIds.add(p._id.toString()));
  }

  if (rosterIds.size === 0) {
    for (const id of updates.keys()) rosterIds.add(id);
  }

  const unknownIds = [...updates.keys()].filter(id => !rosterIds.has(id));
  if (unknownIds.length) {
    const err = new Error('Attendance contains players who are not part of this session roster');
    err.status = 400;
    err.playerIds = unknownIds;
    throw err;
  }

  const existingMap = new Map();
  for (const entry of (session.attendance || [])) {
    const id = (entry.player?._id || entry.player)?.toString();
    if (id) existingMap.set(id, entry);
  }

  const allTargetIds = new Set([...updates.keys(), ...rosterIds]);

  return Array.from(allTargetIds).map(id => {
    const update = updates.get(id);
    const existing = existingMap.get(id);

    if (update) {
      const isAbsent = (update.status || '').toLowerCase() === 'absent';
      return {
        player: id,
        status: isAbsent ? 'absent' : 'present',
        participation: isAbsent
          ? null
          : (['practice', 'match', 'both'].includes(update.participation)
              ? update.participation
              : (existing?.participation || 'both'))
      };
    }

    if (existing) {
      return {
        player: existing.player,
        status: existing.status,
        participation: existing.participation
      };
    }

    return {
      player: id,
      status: 'present',
      participation: 'both'
    };
  });
}

// ── POST /api/sessions  (coach or admin) – Open a new session ─────────
// Body: { date, sport }
// Creates session and adds every player of that coach in that sport.
// Each starts with status 'present' and participation = defaultParticipation.
router.post('/', allow('admin', 'coach'), async (req, res) => {
  try {
    const { date, sport } = req.body;
    if (!date || !sport) {
      return res.status(400).json({ error: 'date and sport are required' });
    }

    const sessionDate = new Date(date);
    if (isNaN(sessionDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date provided' });
    }

    // Disallow future session dates: coach can only create sessions for today or past days
    const now = new Date();
    const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const utcTodayStr = now.toISOString().slice(0, 10);
    const latestTodayStr = localTodayStr > utcTodayStr ? localTodayStr : utcTodayStr;

    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const maxFutureAllowed = new Date(endOfToday.getTime() + (14 * 60 * 60 * 1000));

    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const datePart = date.slice(0, 10);
      if (datePart > latestTodayStr) {
        return res.status(400).json({ error: 'Cannot create attendance sessions for future dates. Please select today or a past date.' });
      }
    } else if (sessionDate > maxFutureAllowed) {
      return res.status(400).json({ error: 'Cannot create attendance sessions for future dates. Please select today or a past date.' });
    }

    const coachId = await resolveCoachId(req, req.body.coachId);
    if (!coachId) {
      return res.status(400).json({
        error: 'No coach account is available. Create a coach before opening a session.'
      });
    }

    // Check for existing session for (coach, date, sport)
    const dayStart = new Date(sessionDate); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(sessionDate); dayEnd.setUTCHours(23, 59, 59, 999);

    const existing = await Session.findOne({
      coach: coachId,
      sport: sport.trim(),
      $or: [
        { date: sessionDate },
        { date: { $gte: dayStart, $lte: dayEnd } }
      ]
    });

    if (existing) {
      return res.status(409).json({ error: 'A session already exists for this coach, date, and sport' });
    }

    // Load all players for this coach and sport
    const players = await Player.find({ coach: coachId, sport: sportRegex(sport) });
    const initialRosterPlayerIds = players.map(p => p._id);

    // CRITICAL: Draft session only. Absolutely NO permanent attendance records saved until Coach explicitly clicks Save Attendance!
    const session = await Session.create({
      date: sessionDate,
      sport: sport.trim(),
      coach: coachId,
      saved: false,
      savedAt: null,
      locked: false,
      attendance: [], // Unsaved draft: no attendance records stored in DB
      initialRosterPlayerIds,
      createdWithCount: initialRosterPlayerIds.length
    });

    broadcastServerSync({ entity: 'session', action: 'created', entityId: session._id.toString() });
    res.status(201).json(session);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A session already exists for this coach, date, and sport' });
    }
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/sessions  (coach → own; admin → all; player → own saved sessions) ───
router.get('/', allow('admin', 'coach', 'player'), async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'coach') {
      filter = { coach: req.user.id };
    } else if (req.user.role === 'player') {
      filter = { 'attendance.player': req.user.playerId, saved: true };
    }

    const sessions = await Session.find(filter).sort({ date: -1 });

    if (req.user.role !== 'player') {
      for (const session of sessions) {
        if (!session.saved) await syncDraftRoster(session);
      }
    }

    await Session.populate(sessions, {
      path: 'attendance.player',
      select: 'name age sport defaultParticipation'
    });

    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions/:id ─────────────────────────────────────
router.get('/:id', allow('admin', 'coach', 'player'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Role-based authorization
    if (req.user.role === 'player') {
      const isIncluded = (session.attendance || []).some(
        a => (a.player?._id || a.player)?.toString() === req.user.playerId?.toString()
      );
      if (!isIncluded || !session.saved) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (req.user.role !== 'player' && !session.saved) {
      await syncDraftRoster(session);
    }

    await session.populate('attendance.player', 'name age sport defaultParticipation');

    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id/save  (coach or admin) – Atomic Save Attendance ───
// Saves whole register and finalizes it cleanly. Automatically locks the session.
router.patch('/:id/save', allow('admin', 'coach'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (session.locked) {
      return res.status(409).json({ error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' });
    }

    const { attendance } = req.body;

    // A draft must be synchronized before its roster is finalized, so a
    // player registered while the draft was open cannot be missed.
    if (!session.saved) {
      await syncDraftRoster(session);
    }
    const finalAttendance = await mergeAttendancePayload(session, attendance);

    // Atomic findOneAndUpdate to save attendance and automatically lock
    const updated = await Session.findOneAndUpdate(
      { _id: req.params.id, locked: false },
      {
        attendance: finalAttendance,
        initialRosterPlayerIds: finalAttendance.map(a => a.player),
        saved: true,
        savedAt: session.savedAt || new Date(),
        locked: true // AUTOMATICALLY LOCK ON EVERY SAVE!
      },
      { returnDocument: 'after' }
    ).populate('attendance.player', 'name age sport defaultParticipation');

    if (!updated) {
      return res.status(409).json({ error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' });
    }

    const conflictInfo = await syncSessionMatchConflicts(updated._id);
    broadcastServerSync({ entity: 'session', action: 'saved', entityId: updated._id.toString() });
    res.json({ message: 'Attendance saved successfully', session: updated, conflicts: conflictInfo });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, playerIds: err.playerIds || [] });
    }
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id/bulk  (coach or admin) – Update attendance array ───
// Body: { attendance: [{ playerId, status, participation }], save?: boolean }
router.patch('/:id/bulk', allow('admin', 'coach'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (session.locked) {
      return res.status(409).json({ error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' });
    }

    const { attendance = [], save = false } = req.body;

    // Keep draft rosters aligned before applying the client update.
    await syncDraftRoster(session);
    const formattedAttendance = await mergeAttendancePayload(session, attendance);

    if (save) {
      // Atomic save
      const updated = await Session.findOneAndUpdate(
        { _id: req.params.id, saved: false, locked: false },
        {
          attendance: formattedAttendance,
          initialRosterPlayerIds: formattedAttendance.map(a => a.player),
          saved: true,
          savedAt: new Date(),
          locked: true
        },
        { returnDocument: 'after' }
      ).populate('attendance.player', 'name age sport defaultParticipation');

      if (!updated) {
        return res.status(409).json({ error: 'Attendance is saved and cannot be changed' });
      }
      const conflictInfo = await syncSessionMatchConflicts(updated._id);
      broadcastServerSync({ entity: 'attendance', action: 'updated', entityId: updated._id.toString() });
      return res.json({ message: 'Attendance saved and finalized', session: updated, conflicts: conflictInfo });
    }

    // Draft update (not saved yet)
    session.attendance = formattedAttendance;
    session.initialRosterPlayerIds = formattedAttendance.map(a => a.player);
    session.createdWithCount = formattedAttendance.length;
    await session.save();
    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await session.populate('attendance.player', 'name age sport defaultParticipation');
    broadcastServerSync({ entity: 'attendance', action: 'updated', entityId: session._id.toString() });
    res.json({ message: 'Attendance updated', session, conflicts: conflictInfo });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, playerIds: err.playerIds || [] });
    }
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id/mark  (coach or admin) – Single athlete status ───
// Body: { playerId, status: 'present' | 'absent', participation?: 'practice' | 'match' | 'both' }
router.patch('/:id/mark', allow('admin', 'coach'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (session.locked) {
      return res.status(409).json({ error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' });
    }

    const { playerId, status, participation } = req.body;
    const normalizedStatus = (status || '').toLowerCase();
    if (!['present', 'absent'].includes(normalizedStatus)) {
      return res.status(400).json({ error: 'status must be present or absent' });
    }

    // Ensure a current player is present in the draft roster before marking.
    await syncDraftRoster(session);

    const entry = session.attendance.find(a => (a.player?._id || a.player)?.toString() === playerId.toString());
    if (!entry) {
      return res.status(404).json({ error: 'Player not in this session' });
    }

    entry.status = normalizedStatus;
    if (normalizedStatus === 'absent') {
      entry.participation = null;
    } else if (participation && ['practice', 'match', 'both'].includes(participation)) {
      entry.participation = participation;
    } else if (!entry.participation) {
      entry.participation = 'both';
    }

    await session.save();
    const conflictInfo = await syncSessionMatchConflicts(session._id);
    broadcastServerSync({ entity: 'attendance', action: 'updated', entityId: session._id.toString() });
    res.json({ message: 'Updated', entry, session, conflicts: conflictInfo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id/unlock  (coach or admin) – Unlock a locked session ───
router.patch('/:id/unlock', allow('admin', 'coach'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!session.locked) {
      return res.status(400).json({ error: 'Session is already unlocked' });
    }

    session.locked = false;
    // Note: session.saved remains true so previously saved attendance is preserved
    await session.save();
    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await session.populate('attendance.player', 'name age sport defaultParticipation');

    broadcastServerSync({ entity: 'session', action: 'unlocked', entityId: session._id.toString() });
    res.json({ message: 'Session unlocked successfully', session, conflicts: conflictInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id/toggle-lock  (coach or admin) – Toggle Lock/Unlock ───
router.patch('/:id/toggle-lock', allow('admin', 'coach'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const isLocked = !!session.locked;
    if (isLocked) {
      session.locked = false;
      // Note: session.saved stays true! Do NOT wipe saved status!
    } else {
      // Locking a draft finalizes its register: include every current player.
      if (!session.saved) {
        await syncDraftRoster(session);
        session.saved = true;
        if (!session.savedAt) session.savedAt = new Date();
      }
      session.locked = true;
    }

    await session.save();
    const conflictInfo = await syncSessionMatchConflicts(session._id);
    await session.populate('attendance.player', 'name age sport defaultParticipation');

    broadcastServerSync({ entity: 'session', action: isLocked ? 'unlocked' : 'locked', entityId: session._id.toString() });
    res.json({ 
      message: isLocked ? 'Session unlocked successfully' : 'Session locked successfully', 
      session,
      locked: session.locked,
      conflicts: conflictInfo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sessions/:id/lock  (Deprecated alias) ───────────
// Stays as a deprecated alias that performs atomic save on current register.
router.patch('/:id/lock', allow('admin', 'coach'), async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (req.user.role === 'coach' && session.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (session.locked) {
      return res.status(409).json({ error: 'Attendance is saved and session is locked. Unlock the session to edit and save attendance.' });
    }

    await syncDraftRoster(session);

    const updated = await Session.findOneAndUpdate(
      { _id: req.params.id, saved: false, locked: false },
      {
        attendance: session.attendance,
        initialRosterPlayerIds: session.attendance.map(a => a.player),
        saved: true,
        savedAt: new Date(),
        locked: true
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(409).json({ error: 'Attendance is saved and cannot be changed' });
    }

    const conflictInfo = await syncSessionMatchConflicts(updated._id);
    broadcastServerSync({ entity: 'session', action: 'locked', entityId: updated._id.toString() });
    res.json({ message: 'Session saved and locked', session: updated, conflicts: conflictInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
