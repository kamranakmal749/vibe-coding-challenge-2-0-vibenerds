// src/routes/matches.js
const router  = require('express').Router();
const Match   = require('../models/Match');
const Player  = require('../models/Player');
const Session = require('../models/Session');
const MatchParticipation = require('../models/MatchParticipation');
const { authenticate, allow } = require('../middleware/auth');
const { resolveCoachId } = require('../utils/coach');
const { sportRegex } = require('../utils/sport');
const { syncSessionMatchConflicts } = require('../services/statsService');
const { broadcastServerSync } = require('./sync');

router.use(authenticate);

// Helper to find any session (saved or unsaved) for a given coach, sport, and match date
async function findAnySession(coachId, sport, matchDate) {
  const d = new Date(matchDate);
  const minTime = Math.min(
    new Date(d).setUTCHours(0, 0, 0, 0),
    new Date(d).setHours(0, 0, 0, 0)
  );
  const maxTime = Math.max(
    new Date(d).setUTCHours(23, 59, 59, 999),
    new Date(d).setHours(23, 59, 59, 999)
  );

  const query = {
    sport: sportRegex(sport),
    date: { $gte: new Date(minTime), $lte: new Date(maxTime) }
  };
  if (coachId) {
    query.coach = coachId;
  }

  let session = await Session.findOne(query).populate('attendance.player', 'name age sport defaultParticipation');
  if (!session && coachId) {
    session = await Session.findOne({
      sport: sportRegex(sport),
      date: { $gte: new Date(minTime), $lte: new Date(maxTime) }
    }).populate('attendance.player', 'name age sport defaultParticipation');
  }
  return session;
}

// ── Standard Playing-Team Sizes for Sports ──────────────────────
const STANDARD_TEAM_SIZES = {
  'cricket': 11,
  'football': 11,
  'basketball': 5,
  'volleyball': 6,
  'field hockey': 11,
  'hockey': 11,
  'kabaddi': 7,
  'badminton singles': 1,
  'badminton doubles': 2,
  'badminton': 1
};

function getStandardTeamSize(sport) {
  if (!sport || typeof sport !== 'string') return 11;
  const key = sport.trim().toLowerCase();
  if (STANDARD_TEAM_SIZES[key] !== undefined) {
    return STANDARD_TEAM_SIZES[key];
  }
  return 11;
}

// ── Time parsing and match schedule calculation helpers ──────
function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return { hours: 0, minutes: 0 };
  const trimmed = timeStr.trim().toLowerCase();
  const isPM = trimmed.includes('pm');
  const isAM = trimmed.includes('am');
  const clean = trimmed.replace(/[ap]m/, '').trim();
  const parts = clean.split(':').map(p => parseInt(p, 10));
  if (isNaN(parts[0])) return { hours: 0, minutes: 0 };
  let hours = parts[0];
  let minutes = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : 0;
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  return { hours, minutes };
}

function getMatchScheduledDateTime(match) {
  if (!match || !match.date) return new Date();
  let year, month, day;
  if (typeof match.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(match.date)) {
    const [y, m, d] = match.date.slice(0, 10).split('-').map(Number);
    year = y;
    month = m - 1;
    day = d;
  } else {
    const d = new Date(match.date);
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
      year = d.getUTCFullYear();
      month = d.getUTCMonth();
      day = d.getUTCDate();
    } else {
      year = d.getFullYear();
      month = d.getMonth();
      day = d.getDate();
    }
  }
  const { hours, minutes } = parseTimeString(match.time);
  return new Date(year, month, day, hours, minutes, 0, 0);
}

function getMatchUnlockDateTime(match) {
  const kickoff = getMatchScheduledDateTime(match);
  return new Date(kickoff.getTime() + 60 * 60 * 1000); // exactly scheduledDateTime + 60 minutes
}

function getEffectiveNow(req) {
  if (process.env.NODE_ENV !== 'production') {
    const mockHeader = req?.headers?.['x-mock-now'] || req?.query?.mockNow;
    if (mockHeader) {
      const mockD = new Date(mockHeader);
      if (!isNaN(mockD.getTime())) return mockD;
    }
  }
  return new Date();
}

function getMatchTimeStatus(match, now = new Date()) {
  if (match.status === 'completed') return 'completed';
  if (match.status === 'cancelled') return 'cancelled';
  const kickoff = getMatchScheduledDateTime(match);
  const unlock = getMatchUnlockDateTime(match);
  const nowMs = now.getTime();
  if (nowMs < kickoff.getTime()) {
    return 'upcoming';
  } else if (nowMs < unlock.getTime()) {
    return 'in_progress';
  } else {
    return 'scoring_available';
  }
}

function enrichMatchScheduleFields(match, req) {
  const now = getEffectiveNow(req);
  const scheduledDateTime = getMatchScheduledDateTime(match);
  const unlockDateTime = getMatchUnlockDateTime(match);
  const timeStatus = getMatchTimeStatus(match, now);
  const isScoringUnlocked = match.status === 'completed' || now.getTime() >= unlockDateTime.getTime();
  return {
    scheduledDateTime: scheduledDateTime.toISOString(),
    unlockDateTime: unlockDateTime.toISOString(),
    timeStatus,
    isScoringUnlocked
  };
}

// ── GET /api/matches/check-eligibility (coach or admin) ─────────
// Query: ?sport=Football&date=YYYY-MM-DD
// Returns standard playing-team size, whether a finalized session exists for that date,
// and the list of eligible (session present) players.
router.get('/check-eligibility', allow('admin', 'coach'), async (req, res) => {
  try {
    const { sport, date } = req.query;
    if (!sport || !date) {
      return res.status(400).json({ error: 'sport and date query parameters are required' });
    }

    const trimmedSport = sport.trim();
    const minTeamSize = getStandardTeamSize(trimmedSport);
    const matchDate = new Date(date);
    if (isNaN(matchDate.getTime())) {
      return res.status(400).json({ error: 'Invalid match date' });
    }

    const coachId = await resolveCoachId(req);
    const session = await findAnySession(coachId, trimmedSport, matchDate);
    const hasAttendance = !!(session && (session.saved || session.locked || (session.attendance && session.attendance.length > 0)));

    if (!hasAttendance) {
      // Check total roster players registered for this sport under this coach / academy
      const totalRosterPlayers = await Player.countDocuments({
        coach: coachId,
        sport: sportRegex(trimmedSport)
      });

      if (totalRosterPlayers < minTeamSize) {
        return res.json({
          sessionFinalized: false,
          sport: trimmedSport,
          date,
          minTeamSize,
          totalEligible: totalRosterPlayers,
          totalSportPlayers: totalRosterPlayers,
          isBlocked: true,
          message: `${trimmedSport} requires at least ${minTeamSize} players, but only ${totalRosterPlayers} are registered in your academy roster.`,
          players: []
        });
      }

      return res.json({
        sessionFinalized: false,
        sport: trimmedSport,
        date,
        minTeamSize,
        totalEligible: 0,
        totalSportPlayers: totalRosterPlayers,
        isBlocked: false,
        message: 'Player selection will be available after practice attendance is recorded for the match date.',
        players: []
      });
    }

    const presentPlayers = (session.attendance || [])
      .filter(a => a.player && a.status === 'present')
      .map(a => {
        const p = a.player || {};
        const pid = (p._id || a.player)?.toString();
        return {
          playerId: pid,
          name: p.name || 'Athlete',
          sport: p.sport || trimmedSport,
          defaultParticipation: p.defaultParticipation || 'both'
        };
      })
      .filter(p => !!p.playerId);

    const totalEligible = presentPlayers.length;
    const isBlocked = totalEligible < minTeamSize;
    const message = isBlocked
      ? `${trimmedSport} requires at least ${minTeamSize} eligible players, but only ${totalEligible} are available.`
      : null;

    res.json({
      sessionFinalized: true,
      sessionId: session._id,
      sport: trimmedSport,
      date,
      minTeamSize,
      totalEligible,
      isBlocked,
      message,
      players: presentPlayers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/matches/:id/eligible-players  (coach or admin) ───
// 1. Find the saved/closed attendance Session for (match.coach, match.date, match.sport).
// 2. If none exists, return { sessionFound: false } with HTTP 200.
// 3. If found but not saved/closed, return { sessionFound: false, reason: 'not_saved' } with HTTP 200.
// 4. If found and saved, return { sessionFound: true, players: [...] } with players who are present (match or both).
// 5. Set match.sessionId to this session's id if not already set.
router.get('/:id/eligible-players', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const session = await findAnySession(match.coach, match.sport, match.date);
    if (!session || (!session.saved && !session.locked)) {
      // Upcoming fixture or fixture without finalized attendance on match date:
      // Allow drafting squad from all registered academy athletes for this sport
      const rosterPlayers = await Player.find({
        coach: match.coach,
        sport: sportRegex(match.sport)
      }).select('_id name sport defaultParticipation');

      const eligiblePlayers = rosterPlayers.map(p => ({
        playerId: p._id.toString(),
        name: p.name || 'Athlete',
        sport: p.sport || match.sport,
        attendanceStatus: 'registered',
        participation: p.defaultParticipation || 'both'
      }));

      return res.status(200).json({
        sessionFound: !!session,
        sessionSaved: !!(session && (session.saved || session.locked)),
        noSessionRequired: true,
        players: eligiblePlayers
      });
    }

    // Session is found and saved/locked (read-only query; match.sessionId is persisted on PUT selected-players)

    // Rule: any player who is PRESENT is eligible for the match,
    // regardless of their participation type (practice/match/both).
    // Only ABSENT players are excluded.
    const eligiblePlayers = (session.attendance || [])
      .filter(a => a.player && a.status === 'present')
      .map(a => {
        const p = a.player || {};
        const pid = (p._id || a.player)?.toString();
        return {
          playerId: pid,
          name: p.name || 'Athlete',
          sport: p.sport || match.sport,
          attendanceStatus: 'present',
          participation: a.participation
        };
      })
      .filter(p => !!p.playerId);

    res.status(200).json({
      sessionFound: true,
      sessionId: session._id,
      players: eligiblePlayers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/matches/:id/selected-players  (coach or admin) ───
// Body: { playerIds: [...] }
// 1. Validate every id is in eligible list (re-derived server side). Reject with 422 if any ineligible.
// 2. Set match.selectedPlayers.
// 3. Upsert MatchParticipation row with played: null for each selected player.
// 4. Remove MatchParticipation rows for unselected players pre-completion (upcoming only).
router.put('/:id/selected-players', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { playerIds = [] } = req.body;
    if (!Array.isArray(playerIds)) {
      return res.status(400).json({ error: 'playerIds must be an array' });
    }

    // Re-derive eligibility server-side
    const session = await findAnySession(match.coach, match.sport, match.date);
    let eligibleMap;

    if (session && (session.saved || session.locked)) {
      // Rule: any player who is PRESENT is eligible — only ABSENT players are blocked.
      eligibleMap = new Set(
        (session.attendance || [])
          .filter(a => a.status === 'present')
          .map(a => (a.player?._id || a.player).toString())
      );
    } else {
      // If no saved session exists yet for this fixture date, draft squad from registered roster
      const rosterPlayers = await Player.find({
        coach: match.coach,
        sport: sportRegex(match.sport)
      }).select('_id');
      eligibleMap = new Set(rosterPlayers.map(p => p._id.toString()));
    }

    const invalidIds = playerIds.filter(id => !eligibleMap.has(id.toString()));
    if (invalidIds.length > 0) {
      return res.status(422).json({
        error: 'One or more selected players are not eligible for this match',
        invalidPlayerIds: invalidIds
      });
    }

    // Deduplicate selected player IDs
    const uniquePlayerIds = [...new Set(playerIds.map(id => id.toString()))];

    const minTeamSize = getStandardTeamSize(match.sport);
    if (uniquePlayerIds.length < minTeamSize) {
      return res.status(400).json({
        error: `${match.sport} requires at least ${minTeamSize} selected players, but only ${uniquePlayerIds.length} were selected.`
      });
    }

    // Set match.selectedPlayers
    match.selectedPlayers = uniquePlayerIds;
    if (session) match.sessionId = session._id;
    await match.save();

    // Upsert MatchParticipation for each selected player (idempotent)
    for (const pid of uniquePlayerIds) {
      await MatchParticipation.findOneAndUpdate(
        { match: match._id, player: pid },
        { $setOnInsert: { played: null, score: null, remarks: '' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Remove MatchParticipation for deselected players while match is 'upcoming'
    if (match.status === 'upcoming') {
      await MatchParticipation.deleteMany({
        match: match._id,
        player: { $nin: uniquePlayerIds }
      });
    }

    await syncSessionMatchConflicts(session._id);
    broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });

    const updatedMatch = await Match.findById(match._id)
      .populate('selectedPlayers', 'name age sport defaultParticipation');

    res.json({
      message: 'Selected players updated successfully',
      match: updatedMatch,
      selectedCount: uniquePlayerIds.length
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Helper list of numeric sports where score is required when played === true
// E.g., Football (goals), Cricket (runs), Basketball (points)
const NUMERIC_SPORTS = ['Football', 'Cricket', 'Basketball'];

// ── GET /api/matches/:id/participation  (coach or admin) ───────
// Returns the participation table: for each selected player, { playerId, name, played, score, remarks }
router.get('/:id/participation', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .populate('selectedPlayers', 'name age sport defaultParticipation');
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const participations = await MatchParticipation.find({ match: match._id })
      .populate('player', 'name age sport defaultParticipation');

    const participationTable = participations.map(p => {
      const playerDoc = p.player || null;
      const pid = playerDoc ? (playerDoc._id ? playerDoc._id.toString() : playerDoc.toString()) : (p.player ? (p.player._id || p.player).toString() : 'deleted');
      return {
        playerId: pid,
        name: playerDoc ? playerDoc.name : 'Deleted Player',
        sport: playerDoc ? playerDoc.sport : match.sport,
        played: p.played,
        score: p.score,
        remarks: p.remarks || '',
        attendanceConflict: !!p.attendanceConflict,
        conflictReason: p.conflictReason || ''
      };
    });

    res.json({
      matchId: match._id,
      status: match.status,
      sport: match.sport,
      participations: participationTable
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/matches/:id/participation/:playerId  (coach or admin)
// Body: { played: true | false, score?, remarks? }
// - If played: false, force score: null
// - If played: true, score required for numeric sports (NUMERIC_SPORTS), optional otherwise
// - Allowed while status !== 'completed', OR editUnlockedUntil is active (Phase 5)
router.patch('/:id/participation/:playerId', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check completion lock and Phase 5 unlock window
    const isUnlockedForEdit = match.editUnlockedUntil && new Date(match.editUnlockedUntil).getTime() > Date.now();
    if (match.status === 'completed' && !isUnlockedForEdit) {
      return res.status(409).json({ error: 'Cannot edit participation on a completed match unless unlocked for edit' });
    }
    if (match.status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot edit participation on a cancelled match' });
    }

    // Enforce 60-minute rule: Reject score/participation updates before scheduled kickoff + 60 minutes
    if (match.status !== 'completed') {
      const unlockTime = getMatchUnlockDateTime(match);
      const effectiveNow = getEffectiveNow(req);
      if (effectiveNow.getTime() < unlockTime.getTime()) {
        const unlockStr = unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return res.status(403).json({
          error: `Scoring is locked until ${unlockStr} (60 minutes after match kickoff)`,
          unlockTime: unlockTime.toISOString(),
          locked: true
        });
      }
    }

    const { played, score, remarks } = req.body;
    if (typeof played !== 'boolean') {
      return res.status(400).json({ error: 'played must be a boolean (true or false)' });
    }

    let finalScore = null;
    if (played === false) {
      finalScore = null;
    } else {
      // played === true
      const isNumericSport = NUMERIC_SPORTS.includes(match.sport);
      if (isNumericSport) {
        if (score === null || score === undefined || score === '' || isNaN(Number(score)) || Number(score) < 0 || Number(score) > 20) {
          return res.status(400).json({ error: `Score must be between 0 and 20 for ${match.sport}` });
        }
        finalScore = Number(score);
      } else {
        if (score !== undefined && score !== null && score !== '') {
          const num = Number(score);
          if (isNaN(num) || num < 0 || num > 20) {
            return res.status(400).json({ error: 'Score must be between 0 and 20' });
          }
          finalScore = num;
        } else {
          finalScore = null;
        }
      }
    }

    const participation = await MatchParticipation.findOneAndUpdate(
      { match: match._id, player: req.params.playerId },
      {
        played,
        score: finalScore,
        remarks: remarks !== undefined ? String(remarks).trim() : ''
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).populate('player', 'name age sport');

    // Also sync to legacy match.entries array for backwards compatibility
    const existingEntryIdx = (match.entries || []).findIndex(
      e => (e.player?._id || e.player).toString() === req.params.playerId
    );
    const legacyResult = played ? 'played' : 'did_not_play';
    const legacyScore = played ? finalScore : null;

    if (existingEntryIdx >= 0) {
      match.entries[existingEntryIdx].result = legacyResult;
      match.entries[existingEntryIdx].score = legacyScore;
    } else {
      match.entries.push({
        player: req.params.playerId,
        result: legacyResult,
        score: legacyScore
      });
    }
    await match.save();
    if (match.sessionId) {
      await syncSessionMatchConflicts(match.sessionId);
    }
    broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });

    res.json({
      message: 'Participation updated successfully',
      participation
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/matches/:id/complete  (coach or admin) ──────────
// 1. Validate every selected player has played set to true or false (not null).
// 2. Set match.status = 'completed'.
router.patch('/:id/complete', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (match.status === 'completed') {
      return res.status(409).json({ error: 'Match is already completed' });
    }
    if (match.status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot complete a cancelled match' });
    }

    // Enforce 60-minute rule: Cannot complete match before scoring unlock time
    const unlockTime = getMatchUnlockDateTime(match);
    const effectiveNow = getEffectiveNow(req);
    if (effectiveNow.getTime() < unlockTime.getTime()) {
      const unlockStr = unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return res.status(403).json({
        error: `Cannot complete match before scoring unlock time (${unlockStr})`,
        unlockTime: unlockTime.toISOString(),
        locked: true
      });
    }

    if (!match.selectedPlayers || match.selectedPlayers.length === 0) {
      return res.status(422).json({ error: 'Cannot complete a match with no selected players' });
    }

    const participations = await MatchParticipation.find({ match: match._id })
      .populate('player', 'name age sport defaultParticipation');
    const partMap = new Map(participations.map(p => [(p.player?._id || p.player)?.toString() || 'deleted', p]));

    const missingStatusPlayerIds = [];
    for (const pid of match.selectedPlayers) {
      const pStr = pid.toString();
      const pRecord = partMap.get(pStr);
      if (!pRecord || pRecord.played === null || pRecord.played === undefined) {
        missingStatusPlayerIds.push(pStr);
      }
    }

    if (missingStatusPlayerIds.length > 0) {
      return res.status(422).json({
        error: 'All selected players must have a Played/Not Played status before completing the match',
        missingStatusPlayerIds
      });
    }

    match.status = 'completed';
    match.editUnlockedUntil = null; // Lock edit window on completion

    // Sync legacy entries array for backward compatibility
    match.entries = participations.map(p => ({
      player: p.player?._id || p.player,
      result: p.played ? 'played' : 'did_not_play',
      score: p.played ? (p.score !== null && p.score !== undefined ? p.score : 0) : null
    }));

    await match.save();

    if (match.sessionId) {
      await syncSessionMatchConflicts(match.sessionId);
    }
    broadcastServerSync({ entity: 'match', action: 'completed', entityId: match._id.toString() });

    res.json({
      message: 'Match marked as completed',
      match
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/matches/:id/save-all  (coach or admin) ────────────
// Unified endpoint for single-screen match management (Save Draft & Save & Complete Match)
// Body: { selectedPlayerIds: string[], participations?: [{ playerId, played, score, remarks }], complete?: boolean }
router.post('/:id/save-all', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const isUnlockedForEdit = match.editUnlockedUntil && new Date(match.editUnlockedUntil).getTime() > Date.now();
    if (match.status === 'completed' && !isUnlockedForEdit) {
      return res.status(409).json({ error: 'Cannot edit participation on a completed match unless unlocked for edit' });
    }
    if (match.status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot edit a cancelled match' });
    }

    const { selectedPlayerIds = [], participations = [], complete = false } = req.body;
    if (!Array.isArray(selectedPlayerIds)) {
      return res.status(400).json({ error: 'selectedPlayerIds must be an array' });
    }

    const uniquePlayerIds = [...new Set(selectedPlayerIds.map(id => id.toString()))];

    // Validate eligibility against practice session (or registered roster if upcoming without saved session)
    const session = await findAnySession(match.coach, match.sport, match.date);
    let eligibleMap;

    if (session && (session.saved || session.locked)) {
      eligibleMap = new Set(
        (session.attendance || [])
          .filter(a => a.status === 'present')
          .map(a => (a.player?._id || a.player).toString())
      );
    } else {
      const rosterPlayers = await Player.find({
        coach: match.coach,
        sport: sportRegex(match.sport)
      }).select('_id');
      eligibleMap = new Set(rosterPlayers.map(p => p._id.toString()));
    }

    if (uniquePlayerIds.length > 0) {
      const invalidIds = uniquePlayerIds.filter(id => !eligibleMap.has(id.toString()));
      if (invalidIds.length > 0) {
        return res.status(422).json({
          error: 'One or more selected players are not eligible for this match',
          invalidPlayerIds: invalidIds
        });
      }
    }

    const minTeamSize = getStandardTeamSize(match.sport);
    if (uniquePlayerIds.length > 0 && uniquePlayerIds.length < minTeamSize) {
      return res.status(400).json({
        error: `${match.sport} requires at least ${minTeamSize} selected players, but only ${uniquePlayerIds.length} were selected.`
      });
    }

    if (complete && uniquePlayerIds.length < minTeamSize) {
      return res.status(400).json({
        error: `${match.sport} requires at least ${minTeamSize} selected players to complete the match, but only ${uniquePlayerIds.length} were selected.`
      });
    }

    // Update match selectedPlayers
    match.selectedPlayers = uniquePlayerIds;
    if (session) match.sessionId = session._id;

    // Check scoring unlock status
    const unlockTime = getMatchUnlockDateTime(match);
    const effectiveNow = getEffectiveNow(req);
    const isScoringUnlocked = match.status === 'completed' || isUnlockedForEdit || effectiveNow.getTime() >= unlockTime.getTime();

    // If scoring is locked and any participation status is submitted
    const hasParticipationData = Array.isArray(participations) && participations.some(p => p && p.played !== null && p.played !== undefined);
    if (hasParticipationData && !isScoringUnlocked) {
      const unlockStr = unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return res.status(403).json({
        error: `Scoring is locked until ${unlockStr} (60 minutes after match kickoff)`,
        unlockTime: unlockTime.toISOString(),
        locked: true
      });
    }

    // Upsert or update MatchParticipation rows for selected players
    const partMap = new Map();
    if (Array.isArray(participations)) {
      for (const p of participations) {
        if (p && p.playerId) partMap.set(p.playerId.toString(), p);
      }
    }

    for (const pid of uniquePlayerIds) {
      const pData = partMap.get(pid);
      if (isScoringUnlocked && pData && (pData.played === true || pData.played === false)) {
        const played = pData.played;
        let score = null;
        if (played === true) {
          if (pData.score !== null && pData.score !== undefined && pData.score !== '') {
            const num = Number(pData.score);
            if (isNaN(num) || num < 0 || num > 20) {
              return res.status(400).json({ error: `Score for player must be strictly between 0 and 20` });
            }
            score = num;
          } else {
            score = 0;
          }
        }
        const remarks = (pData.remarks || '').trim();
        await MatchParticipation.findOneAndUpdate(
          { match: match._id, player: pid },
          { $set: { played, score, remarks } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } else {
        await MatchParticipation.findOneAndUpdate(
          { match: match._id, player: pid },
          { $setOnInsert: { played: null, score: null, remarks: '' } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    // Remove MatchParticipation for unselected players if not completed
    if (match.status !== 'completed') {
      await MatchParticipation.deleteMany({
        match: match._id,
        player: { $nin: uniquePlayerIds }
      });
    }

    // Handle Complete Match action
    if (complete) {
      if (!isScoringUnlocked) {
        const unlockStr = unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return res.status(403).json({
          error: `Cannot complete match before scoring unlock time (${unlockStr})`,
          unlockTime: unlockTime.toISOString(),
          locked: true
        });
      }

      if (uniquePlayerIds.length === 0) {
        return res.status(422).json({ error: 'Cannot complete a match with no selected players' });
      }

      const allParts = await MatchParticipation.find({ match: match._id });
      const currentPartMap = new Map(allParts.map(p => [(p.player?._id || p.player).toString(), p]));
      const missing = [];
      for (const pid of uniquePlayerIds) {
        const pRecord = currentPartMap.get(pid);
        if (!pRecord || pRecord.played === null || pRecord.played === undefined) {
          missing.push(pid);
        }
      }

      if (missing.length > 0) {
        return res.status(422).json({
          error: 'All selected players must have Played or Did Not Play status recorded before completing the match',
          missingPlayerIds: missing
        });
      }

      match.status = 'completed';
      match.editUnlockedUntil = null;
    }

    // Sync legacy match.entries
    const finalParts = await MatchParticipation.find({ match: match._id })
      .populate('player', 'name age sport defaultParticipation');

    match.entries = finalParts.map(p => ({
      player: p.player?._id || p.player,
      result: p.played ? 'played' : 'did_not_play',
      score: p.played ? (p.score !== null && p.score !== undefined ? p.score : 0) : null
    }));

    await match.save();

    if (match.sessionId) {
      await syncSessionMatchConflicts(match.sessionId);
    }

    broadcastServerSync({
      entity: 'match',
      action: complete ? 'completed' : 'updated',
      entityId: match._id.toString()
    });

    const populatedMatch = await Match.findById(match._id)
      .populate('selectedPlayers', 'name age sport defaultParticipation');

    res.json({
      message: complete ? 'Match saved and completed successfully' : 'Match saved successfully',
      match: populatedMatch,
      participations: finalParts
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/matches  (coach or admin) ────────────────────────
// Body: { title, sport, date, time, opponent, venue, description, selectedPlayerIds }
// Creates the match. Automatically determines standard team size.
// If a finalized practice session exists for that date and sport:
// - Validates eligible players >= standard minimum team size
// - Automatically selects eligible players (or coach-specified subset >= minTeamSize)
// If no finalized practice session exists (e.g. future match scheduled in advance):
// - Creates match with empty squad; player selection deferred until session attendance is taken.
router.post('/', allow('admin', 'coach'), async (req, res) => {
  try {
    const { title, sport, date, time, opponent, venue, description, selectedPlayerIds, selectedPlayers, maxSquadSize } = req.body;
    if (!title || !sport || !date || !time || !opponent || !venue) {
      return res.status(400).json({ error: 'title, sport, date, time, opponent, and venue are required' });
    }

    const matchDate = new Date(date);
    if (isNaN(matchDate.getTime())) {
      return res.status(400).json({ error: 'Invalid match date' });
    }

    const trimmedSport = sport.trim();
    const minTeamSize = getStandardTeamSize(trimmedSport);

    let parsedMaxSquad = minTeamSize;
    if (maxSquadSize !== undefined && maxSquadSize !== null && !isNaN(parseInt(maxSquadSize, 10))) {
      parsedMaxSquad = Math.max(1, parseInt(maxSquadSize, 10));
    }

    const coachId = await resolveCoachId(req);
    const session = await findAnySession(coachId, trimmedSport, matchDate);
    const hasAttendanceSession = session && (session.saved || session.locked || (session.attendance && session.attendance.length > 0));

    let finalSelected = [];

    if (hasAttendanceSession) {
      const presentPlayers = (session.attendance || [])
        .filter(a => a.player && a.status === 'present');
      const totalEligible = presentPlayers.length;

      if (totalEligible < minTeamSize) {
        return res.status(400).json({
          error: `${trimmedSport} requires at least ${minTeamSize} eligible players, but only ${totalEligible} are available.`
        });
      }

      const eligibleSet = new Set(
        presentPlayers.map(a => (a.player?._id || a.player).toString())
      );

      const rawProvidedIds = Array.isArray(selectedPlayerIds)
        ? selectedPlayerIds
        : (Array.isArray(selectedPlayers) ? selectedPlayers : null);

      if (rawProvidedIds !== null) {
        const uniqueIds = [...new Set(rawProvidedIds.map(id => (id?._id || id).toString()))];
        const invalidIds = uniqueIds.filter(id => !eligibleSet.has(id));
        if (invalidIds.length > 0) {
          return res.status(422).json({
            error: 'One or more selected players are not eligible for this match',
            invalidPlayerIds: invalidIds
          });
        }
        if (uniqueIds.length < minTeamSize) {
          return res.status(400).json({
            error: `${trimmedSport} requires at least ${minTeamSize} selected players, but only ${uniqueIds.length} were selected.`
          });
        }
        finalSelected = uniqueIds;
      } else {
        // Automatic player selection: select all eligible players by default
        finalSelected = [...eligibleSet];
      }
    } else {
      // Future match / session attendance not recorded yet:
      // Verify coach/academy has at least minTeamSize registered players in their academy roster for this sport
      const totalRosterPlayers = await Player.countDocuments({
        coach: coachId,
        sport: sportRegex(trimmedSport)
      });
      if (totalRosterPlayers < minTeamSize) {
        return res.status(400).json({
          error: `${trimmedSport} requires at least ${minTeamSize} players, but only ${totalRosterPlayers} are registered in your academy roster.`
        });
      }

      const rawProvidedIds = Array.isArray(selectedPlayerIds)
        ? selectedPlayerIds
        : (Array.isArray(selectedPlayers) ? selectedPlayers : null);
      if (rawProvidedIds !== null) {
        const uniqueIds = [...new Set(rawProvidedIds.map(id => (id?._id || id).toString()))];
        if (uniqueIds.length < minTeamSize) {
          return res.status(400).json({
            error: `${trimmedSport} requires at least ${minTeamSize} selected players, but only ${uniqueIds.length} were selected.`
          });
        }
        finalSelected = uniqueIds;
      } else {
        finalSelected = [];
      }
    }

    const match = await Match.create({
      title: title.trim(),
      sport: trimmedSport,
      date: matchDate,
      time: time.trim(),
      opponent: opponent.trim(),
      venue: venue.trim(),
      description: (description || '').trim(),
      coach: coachId || req.user.id,
      sessionId: session ? session._id : null,
      selectedPlayers: finalSelected,
      maxSquadSize: parsedMaxSquad,
      status: 'upcoming',
      entries: []
    });

    // Upsert initial MatchParticipation records for selected players
    if (finalSelected.length > 0) {
      for (const pid of finalSelected) {
        await MatchParticipation.findOneAndUpdate(
          { match: match._id, player: pid },
          { $setOnInsert: { played: null, score: null, remarks: '' } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    broadcastServerSync({ entity: 'match', action: 'created', entityId: match._id.toString() });
    res.status(201).json(match);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A duplicate match entry already exists' });
    }
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /api/matches/:id/entries  (coach or admin) ─────────────
// Replaces the full entries list in one request with strict eligibility validation.
router.put('/:id/entries', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Enforce 60-minute rule: Reject score updates before scheduled kickoff + 60 minutes
    if (match.status !== 'completed') {
      const unlockTime = getMatchUnlockDateTime(match);
      const effectiveNow = getEffectiveNow(req);
      if (effectiveNow.getTime() < unlockTime.getTime()) {
        const unlockStr = unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return res.status(403).json({
          error: `Scoring is locked until ${unlockStr} (60 minutes after match kickoff)`,
          unlockTime: unlockTime.toISOString(),
          locked: true
        });
      }
    }

    // 1. Check if saved session exists for this date and sport
    const session = await findAnySession(match.coach, match.sport, match.date);
    const savedSession = session && (session.saved || session.locked) ? session : null;
    if (!savedSession) {
      return res.status(409).json({ error: 'Save attendance for this date before scoring the match' });
    }

    match.sessionId = savedSession._id;

    // Rule: PRESENT = eligible regardless of participation type. ABSENT = not eligible.
    const eligibleMap = new Map();
    const absentIds = new Set();

    for (const entry of (savedSession.attendance || [])) {
      const pid = (entry.player?._id || entry.player).toString();
      if (entry.status === 'present') {
        eligibleMap.set(pid, entry);
      } else {
        absentIds.add(pid);
      }
    }

    const rawEntries = Array.isArray(req.body.entries) ? req.body.entries : (Array.isArray(req.body) ? req.body : []);

    // 2. Reject ineligible players (only absent ones)
    const rejectedAbsent = [];
    const rejectedUnknown = [];

    for (const item of rawEntries) {
      const pid = (item.playerId || item.player?._id || item.player)?.toString();
      if (!pid) continue;

      if (absentIds.has(pid)) {
        rejectedAbsent.push(pid);
      } else if (!eligibleMap.has(pid)) {
        rejectedUnknown.push(pid);
      }
    }

    if (rejectedAbsent.length > 0) {
      return res.status(422).json({
        error: 'Absent on this date',
        reason: 'Absent on this date',
        playerIds: rejectedAbsent
      });
    }

    if (rejectedUnknown.length > 0) {
      return res.status(422).json({
        error: 'Player not eligible for this match',
        reason: 'Player not eligible for this match',
        playerIds: rejectedUnknown
      });
    }

    // 3. Check that EVERY eligible player appears exactly once
    const submittedMap = new Map();
    for (const item of rawEntries) {
      const pid = (item.playerId || item.player?._id || item.player)?.toString();
      if (!pid) {
        return res.status(422).json({ error: 'Missing player ID in entry' });
      }
      if (submittedMap.has(pid)) {
        return res.status(422).json({ error: `Duplicate entry for player ${pid}` });
      }
      submittedMap.set(pid, item);
    }

    const missingIds = [];
    for (const eligibleId of eligibleMap.keys()) {
      if (!submittedMap.has(eligibleId)) {
        missingIds.push(eligibleId);
      }
    }

    if (missingIds.length > 0) {
      return res.status(422).json({
        error: 'Needs a score or Did not play',
        reason: 'Needs a score or Did not play',
        missingPlayerIds: missingIds
      });
    }

    // 4. Validate results and scores for each entry
    const validatedEntries = [];
    for (const [pid, item] of submittedMap.entries()) {
      const { result, score } = item;
      if (!['played', 'did_not_play'].includes(result)) {
        return res.status(422).json({ error: `Invalid result '${result}' for player ${pid}. Must be played or did_not_play.` });
      }

      if (result === 'played') {
        const numScore = Number(score);
        if (score === null || score === undefined || isNaN(numScore) || !Number.isInteger(numScore) || numScore < 0 || numScore > 20) {
          return res.status(422).json({ error: `Played entry requires a valid score (integer between 0 and 20) for player ${pid}` });
        }
        validatedEntries.push({
          player: pid,
          result: 'played',
          score: numScore
        });
      } else {
        validatedEntries.push({
          player: pid,
          result: 'did_not_play',
          score: null
        });
      }
    }

    // Save and commit
    match.entries = validatedEntries;
    await match.save();
    await match.populate('entries.player', 'name age sport defaultParticipation');

    res.json({ message: 'Match entries saved successfully', match });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/matches/:id/reopen-for-edit  (coach or admin) ───
// Body: none. Only on 'completed' matches.
// Sets editUnlockedUntil to Date.now() + 5 minutes (5-minute unlock window).
// Status remains 'completed' throughout.
router.patch('/:id/reopen-for-edit', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (match.status !== 'completed') {
      return res.status(409).json({ error: 'Only completed matches can be reopened for editing' });
    }

    // Set 5-minute unlock window
    const unlockDurationMs = 5 * 60 * 1000;
    match.editUnlockedUntil = new Date(Date.now() + unlockDurationMs);
    await match.save();

    broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });

    res.json({
      message: 'Match unlocked for participation editing for 5 minutes',
      editUnlockedUntil: match.editUnlockedUntil,
      status: match.status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/matches/:id/edit-scores  (coach or admin) ──────
// Directly updates scores on a completed match without requiring an unlock window.
// Body: { scores: [{ playerId: string, score: number }] }
// Only modifies score values for players already recorded as "played".
// Does NOT change played/dnp status, squad selection, or match status.
router.patch('/:id/edit-scores', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (match.status !== 'completed') {
      return res.status(409).json({ error: 'Only completed matches support direct score editing' });
    }

    const { scores } = req.body;
    if (!Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({ error: 'scores must be a non-empty array of { playerId, score }' });
    }

    // Validate and apply score updates only to existing "played" participations
    const updatedIds = [];
    for (const entry of scores) {
      const { playerId, score } = entry;
      if (!playerId) continue;

      const numScore = Number(score);
      if (isNaN(numScore) || numScore < 0 || numScore > 20) {
        return res.status(400).json({
          error: `Invalid score ${score} for player ${playerId}. Scores must be between 0 and 20.`
        });
      }

      const part = await MatchParticipation.findOne({ match: match._id, player: playerId });
      if (!part) {
        return res.status(404).json({
          error: `No participation record found for player ${playerId} in this match`
        });
      }
      if (part.played !== true) {
        return res.status(409).json({
          error: `Player ${playerId} is not recorded as "played". Only played players can have scores edited.`
        });
      }

      part.score = numScore;
      await part.save();
      updatedIds.push(playerId);
    }

    // Sync legacy match.entries scores
    const finalParts = await MatchParticipation.find({ match: match._id })
      .populate('player', 'name age sport defaultParticipation');

    match.entries = finalParts.map(p => ({
      player: p.player?._id || p.player,
      result: p.played ? 'played' : 'did_not_play',
      score: p.played ? (p.score !== null && p.score !== undefined ? p.score : 0) : null
    }));
    await match.save();

    broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });

    // Return the updated match with participations for the frontend to re-render
    const populatedMatch = await Match.findById(match._id)
      .populate('entries.player', 'name age sport defaultParticipation')
      .populate('selectedPlayers', 'name age sport defaultParticipation')
      .populate('sessionId', 'date sport saved');

    const livePlayers = await Player.find({}, '_id').lean();
    const livePlayerIds = new Set(livePlayers.map(p => p._id.toString()));
    const liveParticipations = finalParts.filter(p => {
      const pid = (p.player?._id || p.player)?.toString();
      return livePlayerIds.has(pid);
    });
    const totalPlayed = liveParticipations.filter(p => p.played === true && !p.attendanceConflict).length;
    const totalDidNotPlay = liveParticipations.filter(p => p.played === false).length;

    const matchObj = populatedMatch.toObject();
    res.json({
      message: `Scores updated successfully for ${updatedIds.length} player(s)`,
      match: {
        ...matchObj,
        _id: (populatedMatch._id || populatedMatch.id).toString(),
        id: (populatedMatch._id || populatedMatch.id).toString(),
        totalPlayed,
        totalDidNotPlay,
        participations: liveParticipations
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/matches/history  (coach or admin) ────────────────
// Returns only status: 'completed' matches with filters: sport, opponent, date (or startDate/endDate range)
// Includes count of players who played per match (totalPlayed)
router.get('/history', allow('admin', 'coach'), async (req, res) => {
  try {
    const { sport, opponent, date, startDate, endDate } = req.query;

    const filter = { status: 'completed' };
    if (req.user.role === 'coach') {
      const coachId = await resolveCoachId(req);
      filter.$or = [{ coach: req.user.id }, { coach: coachId }];
    }
    if (sport) {
      filter.sport = sport.trim();
    }
    if (opponent) {
      filter.opponent = { $regex: opponent.trim(), $options: 'i' };
    }
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const start = new Date(d); start.setUTCHours(0, 0, 0, 0);
        const end = new Date(d); end.setUTCHours(23, 59, 59, 999);
        filter.date = { $gte: start, $lte: end };
      }
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const sd = new Date(startDate);
        if (!isNaN(sd.getTime())) {
          sd.setUTCHours(0, 0, 0, 0);
          filter.date.$gte = sd;
        }
      }
      if (endDate) {
        const ed = new Date(endDate);
        if (!isNaN(ed.getTime())) {
          ed.setUTCHours(23, 59, 59, 999);
          filter.date.$lte = ed;
        }
      }
    }

    const matches = await Match.find(filter)
      .sort({ date: -1 })
      .populate('selectedPlayers', 'name age sport')
      .populate('sessionId', 'date sport saved');

    // Attach totalPlayed count for each match, filtering only for currently living players
    const matchIds = matches.map(m => m._id);
    const livePlayers = await Player.find({}, '_id').lean();
    const livePlayerIds = new Set(livePlayers.map(p => p._id.toString()));

    const participations = await MatchParticipation.find({
      match: { $in: matchIds }
    }).populate('player', 'name age sport defaultParticipation').lean();

    const playedCountMap = new Map();
    const matchParticipationsMap = new Map();
    for (const p of participations) {
      const pid = (p.player?._id || p.player)?.toString();
      if (!livePlayerIds.has(pid)) continue; // defensive filter for deleted athletes
      const mid = p.match.toString();
      if (!matchParticipationsMap.has(mid)) {
        matchParticipationsMap.set(mid, []);
      }
      matchParticipationsMap.get(mid).push(p);

      if (p.played === true && !p.attendanceConflict) {
        playedCountMap.set(mid, (playedCountMap.get(mid) || 0) + 1);
      }
    }

    const historyItems = matches.map(m => {
      const mObj = m.toObject();
      // Count played from MatchParticipation if available, fallback to legacy entries
      let totalPlayed = playedCountMap.get(m._id.toString());
      if (totalPlayed === undefined) {
        totalPlayed = (m.entries || []).filter(e => {
          const pid = (e.player?._id || e.player)?.toString();
          return livePlayerIds.has(pid) && e.result === 'played';
        }).length;
      }
      const scheduleInfo = enrichMatchScheduleFields(m, req);
      return {
        ...mObj,
        totalPlayed,
        participations: matchParticipationsMap.get(m._id.toString()) || [],
        ...scheduleInfo
      };
    });

    res.json(historyItems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/matches/calendar  (coach or admin) ─────────────────
// Query: ?month=YYYY-MM
// Returns matches for that month with minimal fields for calendar rendering
router.get('/calendar', allow('admin', 'coach'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Valid month query param in YYYY-MM format is required' });
    }

    const [year, m] = month.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999));

    const filter = {
      date: { $gte: startDate, $lte: endDate },
      status: 'upcoming'
    };

    if (req.user.role === 'coach') {
      const coachId = await resolveCoachId(req);
      filter.$or = [{ coach: req.user.id }, { coach: coachId }];
    }

    const matches = await Match.find(filter)
      .sort({ date: 1, time: 1 })
      .select('title sport date time opponent venue status');

    const calendarMatches = matches.map(m => ({
      _id: (m._id || m.id).toString(),
      id: (m._id || m.id).toString(),
      title: m.title,
      sport: m.sport,
      date: m.date,
      time: m.time,
      opponent: m.opponent,
      venue: m.venue,
      status: m.status
    }));

    res.json(calendarMatches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/matches  ─────────────────────────────────────────
// Admin → all; Coach → own; Player → matches where they have a 'played' entry
// Supports query params: sport, date, opponent, status
router.get('/', async (req, res) => {
  try {
    const { sport, date, opponent, status } = req.query;

    if (req.user.role === 'admin' || req.user.role === 'coach') {
      const filter = {};
      if (req.user.role === 'coach') {
        filter.coach = req.user.id;
      }
      if (sport) {
        filter.sport = sport.trim();
      }
      if (status) {
        filter.status = status.trim();
      }
      if (opponent) {
        filter.opponent = { $regex: opponent.trim(), $options: 'i' };
      }
      if (date) {
        const d = new Date(date);
        if (!isNaN(d.getTime())) {
          const start = new Date(d); start.setUTCHours(0, 0, 0, 0);
          const end = new Date(d); end.setUTCHours(23, 59, 59, 999);
          filter.date = { $gte: start, $lte: end };
        }
      }

      const matches = await Match.find(filter)
        .sort({ date: -1 })
        .populate('entries.player', 'name age sport')
        .populate('selectedPlayers', 'name age sport')
        .populate('sessionId', 'date sport saved');

      const matchIds = matches.map(m => m._id);
      const participations = await MatchParticipation.find({
        match: { $in: matchIds }
      }).populate('player', 'name age sport defaultParticipation').lean();

      const playedCountMap = new Map();
      const matchParticipationsMap = new Map();
      for (const p of participations) {
        const mid = p.match.toString();
        if (!matchParticipationsMap.has(mid)) {
          matchParticipationsMap.set(mid, []);
        }
        matchParticipationsMap.get(mid).push(p);

        if (p.played === true && !p.attendanceConflict) {
          playedCountMap.set(mid, (playedCountMap.get(mid) || 0) + 1);
        }
      }

      // Fetch saved/locked sessions to compute eligible players count for each match
      const coachFilter = req.user.role === 'coach' ? req.user.id : { $in: matches.map(m => m.coach) };
      const savedSessions = await Session.find({
        coach: coachFilter,
        $or: [{ saved: true }, { locked: true }]
      }).lean();

      function getEligibleCountForMatch(match) {
        const mDate = new Date(match.date);
        const mDateStr = mDate.toISOString().slice(0, 10);
        const session = savedSessions.find(s => {
          if (s.sport !== match.sport) return false;
          if (s.coach.toString() !== match.coach.toString()) return false;
          const sDateStr = new Date(s.date).toISOString().slice(0, 10);
          return sDateStr === mDateStr;
        });
        if (!session) return 0;
        return (session.attendance || []).filter(a => a.player && a.status === 'present').length;
      }

      const matchObjects = matches.map(m => {
        const mObj = m.toObject();
        let totalPlayed = playedCountMap.get(m._id.toString());
        if (totalPlayed === undefined) {
          totalPlayed = (m.entries || []).filter(e => e.result === 'played').length;
        }
        const totalEligiblePlayers = getEligibleCountForMatch(m);
        const scheduleInfo = enrichMatchScheduleFields(m, req);
        const stdSize = getStandardTeamSize(m.sport);
        return {
          ...mObj,
          _id: (m._id || m.id).toString(),
          id: (m._id || m.id).toString(),
          totalEligiblePlayers,
          eligiblePlayersCount: totalEligiblePlayers,
          standardTeamSize: stdSize,
          minTeamSize: stdSize,
          totalPlayed,
          participations: matchParticipationsMap.get(m._id.toString()) || [],
          ...scheduleInfo
        };
      });

      return res.json(matchObjects);
    }

    if (req.user.role === 'player') {
      const playerId = req.user.playerId;
      if (!playerId) return res.json([]);

      // 1. Find matches where player played via modern MatchParticipation (excluding attendance conflicts)
      const participations = await MatchParticipation.find({
        player: playerId,
        played: true,
        attendanceConflict: { $ne: true }
      }).select('match').lean();
      const participationMatchIds = participations.map(p => p.match);

      // 2. Query matches matching either MatchParticipation IDs OR legacy entries/scores
      const allMatches = await Match.find({
        $or: [
          { _id: { $in: participationMatchIds } },
          { 'entries.player': playerId, 'entries.result': 'played' },
          { 'scores.player': playerId }
        ]
      })
      .sort({ date: -1 })
      .populate('entries.player', 'name age sport')
      .populate('selectedPlayers', 'name age sport')
      .populate('sessionId', 'date sport saved');

      const matches = allMatches.filter(m => {
        // If matched via modern participation
        if (participationMatchIds.some(id => id.toString() === m._id.toString())) {
          return true;
        }
        // Fallback to legacy entries / scores
        if (m.entries && m.entries.length > 0) {
          const entry = m.entries.find(e => (e.player?._id || e.player).toString() === playerId.toString());
          return entry && entry.result === 'played';
        }
        return m.scores && m.scores.some(s => (s.player?._id || s.player).toString() === playerId.toString());
      });

      return res.json(matches);
    }

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/matches/:id ─────────────────────────────────────
// Returns full match details plus computed counts: totalEligiblePlayers, totalPlayed, totalDidNotPlay
router.get('/:id', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .populate('entries.player', 'name age sport defaultParticipation')
      .populate('selectedPlayers', 'name age sport defaultParticipation')
      .populate('sessionId', 'date sport saved');

    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Compute participation counts, filtering only for currently living players
    const livePlayers = await Player.find({}, '_id').lean();
    const livePlayerIds = new Set(livePlayers.map(p => p._id.toString()));

    const participations = await MatchParticipation.find({ match: match._id })
      .populate('player', 'name age sport defaultParticipation');
    const liveParticipations = participations.filter(p => {
      const pid = (p.player?._id || p.player)?.toString();
      return livePlayerIds.has(pid);
    });
    const totalPlayed = liveParticipations.filter(p => p.played === true && !p.attendanceConflict).length;
    const totalDidNotPlay = liveParticipations.filter(p => p.played === false).length;
    const totalConflicted = liveParticipations.filter(p => p.attendanceConflict === true).length;

    // Derived eligible count from saved session if linked
    let totalEligiblePlayers = 0;
    const session = match.sessionId
      ? await Session.findById(match.sessionId)
      : await findAnySession(match.coach, match.sport, match.date);

    if (session && (session.saved || session.locked)) {
      totalEligiblePlayers = (session.attendance || []).filter(
        a => a.player && a.status === 'present'
      ).length;
    }

    const matchObj = match.toObject();
    if (matchObj.selectedPlayers) {
      matchObj.selectedPlayers = matchObj.selectedPlayers.filter(Boolean);
    }
    if (matchObj.entries) {
      matchObj.entries = matchObj.entries.map(e => ({
        ...e,
        player: e.player || { name: 'Deleted Player', sport: matchObj.sport }
      }));
    }
    const scheduleInfo = enrichMatchScheduleFields(match, req);
    const stdSize = getStandardTeamSize(match.sport);
    res.json({
      ...matchObj,
      _id: (match._id || match.id).toString(),
      id: (match._id || match.id).toString(),
      totalEligiblePlayers,
      eligiblePlayersCount: totalEligiblePlayers,
      standardTeamSize: stdSize,
      minTeamSize: stdSize,
      totalPlayed,
      totalDidNotPlay,
      totalConflicted,
      participations: liveParticipations,
      ...scheduleInfo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/matches/:id  (coach or admin) ───────────────────
// Edits title/sport/date/time/opponent/venue/description.
// Only allowed while status is 'upcoming'. Returns 409 if status is 'completed' or 'cancelled'.
router.patch('/:id', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (match.status !== 'upcoming') {
      return res.status(409).json({ error: `Cannot edit match when status is ${match.status}. Only upcoming matches can be edited.` });
    }

    const { title, sport, date, time, opponent, venue, description, maxSquadSize } = req.body;
    if (title !== undefined) match.title = title.trim();
    if (sport !== undefined) match.sport = sport.trim();
    if (time !== undefined) match.time = time.trim();
    if (opponent !== undefined) match.opponent = opponent.trim();
    if (venue !== undefined) match.venue = venue.trim();
    if (description !== undefined) match.description = description.trim();
    if (maxSquadSize !== undefined && !isNaN(parseInt(maxSquadSize, 10))) {
      match.maxSquadSize = Math.max(1, parseInt(maxSquadSize, 10));
    }
    if (date !== undefined) {
      const matchDate = new Date(date);
      if (isNaN(matchDate.getTime())) {
        return res.status(400).json({ error: 'Invalid match date' });
      }
      match.date = matchDate;
    }

    await match.save();
    broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });
    res.json({
      ...match.toObject(),
      ...enrichMatchScheduleFields(match, req)
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A duplicate match entry already exists with these details' });
    }
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/matches/:id/cancel  (coach or admin) ────────────
// Sets status to 'cancelled'. Only allowed from 'upcoming'.
router.patch('/:id/cancel', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (match.status !== 'upcoming') {
      return res.status(409).json({ error: `Cannot cancel match when status is ${match.status}. Only upcoming matches can be cancelled.` });
    }

    match.status = 'cancelled';
    await match.save();
    broadcastServerSync({ entity: 'match', action: 'cancelled', entityId: match._id.toString() });
    res.json({ message: 'Match cancelled successfully', match });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/matches/:id  (coach or admin) ───────────────────
// Permanently deletes / removes a match and associated participation records
router.delete('/:id', allow('admin', 'coach'), async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (req.user.role === 'coach' && match.coach.toString() !== req.user.id) {
      const coachId = await resolveCoachId(req);
      if (match.coach.toString() !== coachId?.toString()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const sessionId = match.sessionId;
    await MatchParticipation.deleteMany({ match: match._id });
    await Match.findByIdAndDelete(match._id);

    if (sessionId) {
      try {
        await syncSessionMatchConflicts(sessionId);
      } catch (syncErr) {
        console.warn('Sync session conflict error on match delete:', syncErr.message);
      }
    }

    broadcastServerSync({ entity: 'match', action: 'deleted', entityId: req.params.id });
    res.json({ message: 'Match deleted successfully', matchId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
