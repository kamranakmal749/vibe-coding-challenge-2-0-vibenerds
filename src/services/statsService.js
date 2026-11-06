// src/services/statsService.js
// Centralized calculation and synchronization service for MaidanDesk.
// Enforces a single source of truth for:
// 1. Session attendance rate / turnout %
// 2. Individual player attendance %
// 3. Valid matches played (excluding attendance conflicts)
// 4. Trial readiness (dynamically derived: Attendance >= 75% AND Valid Matches >= 2)
// 5. Attendance-Match conflict detection & synchronization

const mongoose = require('mongoose');
const Session = require('../models/Session');
const Match = require('../models/Match');
const MatchParticipation = require('../models/MatchParticipation');
const Player = require('../models/Player');
const { sportRegex } = require('../utils/sport');

/**
 * 1. Calculate Session Attendance Turnout
 * Formula: Players Present / Total eligible players in session roster * 100
 */
function calculateSessionAttendance(session) {
  const attendance = session.attendance || [];
  const totalCount = attendance.length;
  const presentCount = attendance.filter(a => a.status === 'present').length;
  const absentCount = totalCount - presentCount;
  const attendanceRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  return {
    presentCount,
    absentCount,
    totalCount,
    attendanceRate
  };
}

/**
 * 2. Synchronize Attendance Conflicts Between a Session and Linked Matches (Phase 4)
 * When a player's attendance changes:
 * - If absent, any match participation on that session's match is flagged as attendanceConflict = true.
 * - If present, any existing conflict flag on that match participation is resolved.
 * - Does NOT invent match records.
 * - Preserves historical scores and audit details.
 */
async function syncSessionMatchConflicts(sessionId) {
  if (!sessionId) return { conflictsCount: 0, affectedMatches: [] };

  const session = await Session.findById(sessionId);
  if (!session) return { conflictsCount: 0, affectedMatches: [] };

  const sessionDate = new Date(session.date);
  const minTime = Math.min(
    new Date(sessionDate).setUTCHours(0, 0, 0, 0),
    new Date(sessionDate).setHours(0, 0, 0, 0)
  );
  const maxTime = Math.max(
    new Date(sessionDate).setUTCHours(23, 59, 59, 999),
    new Date(sessionDate).setHours(23, 59, 59, 999)
  );

  // Find all matches linked by sessionId OR by same (coach, sport, date)
  const matches = await Match.find({
    coach: session.coach,
    sport: session.sport,
    $or: [
      { sessionId: session._id },
      { date: { $gte: new Date(minTime), $lte: new Date(maxTime) } }
    ]
  });

  const attendanceMap = new Map();
  for (const entry of (session.attendance || [])) {
    const pid = (entry.player?._id || entry.player)?.toString();
    if (pid) {
      attendanceMap.set(pid, {
        status: entry.status,
        participation: entry.participation
      });
    }
  }

  let totalConflicts = 0;
  const affectedMatches = [];

  for (const match of matches) {
    let matchHasConflict = false;
    if (!match.sessionId || match.sessionId.toString() !== session._id.toString()) {
      match.sessionId = session._id;
    }

    if (match.status === 'upcoming') {
      // For upcoming fixtures: only ABSENT players are removed.
      // Present players (regardless of participation type) stay eligible.
      const initialSelected = match.selectedPlayers || [];
      const updatedSelected = [];
      for (const pRef of initialSelected) {
        const pIdStr = (pRef?._id || pRef)?.toString();
        const att = attendanceMap.get(pIdStr);
        if (!att || att.status === 'absent') {
          // Truly absent: remove from selection and remove draft participation
          await MatchParticipation.deleteMany({ match: match._id, player: pIdStr, played: null });
        } else {
          updatedSelected.push(pRef);
        }
      }
      match.selectedPlayers = updatedSelected;

      // Update remaining participations
      const participations = await MatchParticipation.find({ match: match._id });
      for (const part of participations) {
        const pid = (part.player?._id || part.player)?.toString();
        const att = attendanceMap.get(pid);
        if (!att || att.status === 'absent') {
          part.attendanceConflict = true;
          part.conflictReason = 'Player marked absent in linked attendance session';
          matchHasConflict = true;
          totalConflicts++;
        } else {
          part.attendanceConflict = false;
          part.conflictReason = '';
        }
        await part.save();
      }
    } else {
      // For completed matches: preserve historical records without deleting!
      // Flag conflict ONLY if absent (not present+practice).
      const participations = await MatchParticipation.find({ match: match._id });

      for (const part of participations) {
        const pid = (part.player?._id || part.player)?.toString();
        const att = attendanceMap.get(pid);

        if (!att || att.status === 'absent') {
          // Player is absent in the linked session — flag conflict
          part.attendanceConflict = true;
          part.conflictReason = att?.status === 'absent'
            ? 'Player marked absent in linked attendance session'
            : 'Player not found in linked session roster';
          matchHasConflict = true;
          totalConflicts++;
        } else {
          // Player is present (any participation type) → clear conflict
          part.attendanceConflict = false;
          part.conflictReason = '';
        }
        await part.save();
      }
    }

    // Also update legacy match entries if present
    if (match.entries && match.entries.length > 0) {
      for (const entry of match.entries) {
        const pid = (entry.player?._id || entry.player)?.toString();
        const att = attendanceMap.get(pid);
        if (!att || att.status === 'absent') {
          matchHasConflict = true;
        }
      }
    }

    match.hasConflict = matchHasConflict;
    match.conflictMessage = matchHasConflict
      ? 'One or more players marked absent in linked attendance session'
      : '';
    await match.save();

    if (matchHasConflict) {
      affectedMatches.push(match._id.toString());
    }
  }

  return {
    conflictsCount: totalConflicts,
    hasConflict: totalConflicts > 0,
    affectedMatches
  };
}

/**
 * Reusable Session Turnout Calculation
 * (Present players / Total eligible players in session) * 100
 */
async function calculateSessionTurnout(sessionId) {
  if (!sessionId) return { presentCount: 0, absentCount: 0, totalCount: 0, attendanceRate: 0 };
  const session = (typeof sessionId === 'object' && sessionId !== null && sessionId.attendance)
    ? sessionId
    : await Session.findById(sessionId);
  if (!session) return { presentCount: 0, absentCount: 0, totalCount: 0, attendanceRate: 0 };
  return calculateSessionAttendance(session);
}

/**
 * Reusable Individual Player Attendance Calculation
 * (Present saved sessions / Total saved sessions) * 100
 */
async function calculateIndividualAttendance(playerId) {
  if (!playerId) return { attendanceRate: 0, presentCount: 0, totalCount: 0, presentSessions: 0, totalSessions: 0 };
  const player = await Player.findById(playerId);
  if (!player) return { attendanceRate: 0, presentCount: 0, totalCount: 0, presentSessions: 0, totalSessions: 0 };

  const coachId = player.coach?._id || player.coach;
  let sessions = [];
  if (coachId) {
    sessions = await Session.find({
      coach: coachId,
      sport: sportRegex(player.sport),
      saved: true,
      'attendance.player': player._id
    });
  }

  const totalCount = sessions.length;
  let presentCount = 0;
  for (const s of sessions) {
    const entry = (s.attendance || []).find(a => {
      const pid = (a.player?._id || a.player)?.toString();
      return pid === player._id.toString();
    });
    if (entry && entry.status === 'present') presentCount++;
  }

  const attendanceRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
  return {
    attendanceRate,
    presentCount,
    totalCount,
    presentSessions: presentCount,
    totalSessions: totalCount
  };
}

/**
 * Reusable Matches Played Calculation
 * Count only actual valid MatchParticipation records where played === true and there is no attendance conflict.
 */
async function calculateMatchesPlayed(playerId) {
  if (!playerId) return 0;
  const pIdStr = playerId.toString();

  const participations = await MatchParticipation.find({
    player: playerId,
    played: true,
    attendanceConflict: { $ne: true }
  }).populate('match', 'status');

  let validMatchesCount = 0;
  const countedMatchIds = new Set();
  for (const part of participations) {
    const m = part.match;
    if (m && m.status === 'completed') {
      validMatchesCount++;
      countedMatchIds.add(m._id.toString());
    }
  }

  // Include legacy entries if any
  const legacyMatches = await Match.find({
    _id: { $nin: Array.from(countedMatchIds) },
    status: 'completed',
    'entries': {
      $elemMatch: {
        player: playerId,
        result: 'played'
      }
    }
  });

  for (const lm of legacyMatches) {
    let hasConflict = false;
    if (lm.sessionId) {
      const s = await Session.findById(lm.sessionId);
      if (s && s.saved) {
        const sEntry = (s.attendance || []).find(a => (a.player?._id || a.player)?.toString() === pIdStr);
        if (!sEntry || sEntry.status === 'absent') {
          hasConflict = true;
        }
      }
    }
    if (!hasConflict) {
      validMatchesCount++;
    }
  }

  return validMatchesCount;
}

/**
 * Reusable Dynamic Trial Readiness Check
 * attendance >= 75% AND matchesPlayed >= 2
 * NEVER stored as a static field.
 */
async function checkTrialReadiness(playerId) {
  const { attendanceRate } = await calculateIndividualAttendance(playerId);
  const matchesPlayed = await calculateMatchesPlayed(playerId);
  const isReady = attendanceRate >= 75 && matchesPlayed >= 2;
  return {
    isReady,
    attendanceRate,
    matchesPlayed
  };
}

/**
 * 3. Centralized Player Metrics Enrichment (Phase 5)
 * Dynamically computes attendance %, valid matches played, and trial readiness.
 */
async function enrichPlayer(player) {
  const p = player.toObject ? player.toObject() : player;

  // Finalized/saved sessions only for this coach and sport
  const coachId = p.coach?._id || p.coach;
  let sessions = [];
  if (coachId) {
    sessions = await Session.find({
      coach: coachId,
      sport: sportRegex(p.sport),
      saved: true,
      'attendance.player': p._id
    });
  }

  const totalCount = sessions.length;
  let presentCount = 0;

  for (const s of sessions) {
    const entry = (s.attendance || []).find(a => {
      const pid = (a.player?._id || a.player)?.toString();
      return pid === p._id.toString();
    });
    if (entry && entry.status === 'present') presentCount++;
  }

  const attendanceRate = totalCount > 0
    ? Math.round((presentCount / totalCount) * 100)
    : 0;

  // Session history for profile breakdown
  const attendanceHistory = sessions.map(s => {
    const entry = (s.attendance || []).find(a => {
      const pid = (a.player?._id || a.player)?.toString();
      return pid === p._id.toString();
    });
    return {
      sessionId: s._id,
      date: s.date,
      sport: s.sport,
      status: entry ? entry.status : 'absent',
      participation: entry ? entry.participation : (p.defaultParticipation || 'both'),
      saved: !!s.saved,
      locked: !!s.locked
    };
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  // Match participations
  const participations = await MatchParticipation.find({ player: p._id })
    .populate('match', 'title sport date time opponent venue status hasConflict conflictMessage');

  let totalMatchesPlayed = 0;
  let totalMatchesSelected = 0;
  let totalMatchesNotPlayed = 0;
  let conflictedMatchesCount = 0;
  const matchHistory = [];
  const countedMatchIds = new Set();

  for (const part of participations) {
    const m = part.match;
    if (!m) continue;
    countedMatchIds.add(m._id.toString());

    if (m.status !== 'cancelled') {
      totalMatchesSelected++;
    }

    if (m.status === 'completed') {
      const isConflicted = !!part.attendanceConflict;
      if (isConflicted) {
        conflictedMatchesCount++;
      }

      if (part.played === true) {
        // ONLY count as played if there is NO attendance conflict!
        if (!isConflicted) {
          totalMatchesPlayed++;
        }
      } else if (part.played === false) {
        totalMatchesNotPlayed++;
      }

      matchHistory.push({
        matchId: m._id,
        title: m.title,
        sport: m.sport,
        date: m.date,
        time: m.time,
        opponent: m.opponent,
        venue: m.venue,
        played: part.played,
        score: part.score,
        remarks: part.remarks || '',
        attendanceConflict: isConflicted,
        conflictReason: part.conflictReason || ''
      });
    }
  }

  // Legacy matches fallback
  const legacyMatches = await Match.find({
    _id: { $nin: Array.from(countedMatchIds) },
    'entries.player': p._id
  });

  for (const lm of legacyMatches) {
    if (lm.status === 'cancelled') continue;
    totalMatchesSelected++;

    let entryPlayed = false;
    let entryScore = null;

    if (lm.entries && lm.entries.length > 0) {
      const entry = lm.entries.find(e => (e.player?._id || e.player)?.toString() === p._id.toString());
      if (entry) {
        if (entry.result === 'played') {
          entryPlayed = true;
          entryScore = entry.score;
        } else {
          totalMatchesNotPlayed++;
        }
      }
    }

    if (entryPlayed) {
      // Check if this legacy match has attendance conflict
      let legacyConflict = false;
      if (lm.sessionId) {
        const linkedSession = await Session.findById(lm.sessionId);
        if (linkedSession && linkedSession.saved) {
          const sEntry = (linkedSession.attendance || []).find(
            a => (a.player?._id || a.player)?.toString() === p._id.toString()
          );
          if (!sEntry || sEntry.status === 'absent') {
            legacyConflict = true;
          }
        }
      }

      if (!legacyConflict) {
        totalMatchesPlayed++;
      } else {
        conflictedMatchesCount++;
      }

      matchHistory.push({
        matchId: lm._id,
        title: lm.title || `Match vs ${lm.opponent}`,
        sport: lm.sport,
        date: lm.date,
        time: lm.time || '10:00',
        opponent: lm.opponent,
        venue: lm.venue || 'Main Stadium',
        played: true,
        score: entryScore,
        remarks: '',
        attendanceConflict: legacyConflict,
        conflictReason: legacyConflict ? 'Player marked absent in linked attendance session' : ''
      });
    }
  }

  matchHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Total matches completed/happened in this player's sport
  const totalSportMatches = await Match.countDocuments({
    sport: sportRegex(p.sport),
    status: 'completed'
  });

  // Trial Readiness:
  // READY only when BOTH conditions are satisfied:
  // - Attendance >= 75%
  // - Valid matches played >= 2
  const isAttendanceReady = totalCount > 0 && (presentCount * 4 >= totalCount * 3);
  const isMatchesReady = totalMatchesPlayed >= 2;
  const isReady = isAttendanceReady && isMatchesReady;

  // Performance score calculation:
  // Count only actual Played match records (excluding Did Not Play or conflicted matches)
  const scoredMatches = matchHistory.filter(
    m => m.played === true && !m.attendanceConflict && m.score !== null && m.score !== undefined
  );
  let performanceScore = null;
  if (typeof p.performanceScore === 'number') {
    performanceScore = p.performanceScore;
  } else if (scoredMatches.length > 0) {
    const totalScore = scoredMatches.reduce((acc, m) => acc + Number(m.score), 0);
    performanceScore = Math.round((totalScore / scoredMatches.length) * 10) / 10;
  }
  const hasPerformanceStar = typeof performanceScore === 'number' && performanceScore >= 15;

  return {
    ...p,
    playerId: p.playerId || p.username || '',
    username: p.username || p.playerId || '',
    attendanceRate,
    presentSessions: presentCount,
    totalSessions: totalCount,
    attendanceHistory,
    matchesPlayed: totalMatchesPlayed,
    matchCount: totalMatchesPlayed,
    totalMatchesPlayed,
    totalMatchesSelected,
    totalMatchesNotPlayed,
    conflictedMatchesCount,
    matchHistory,
    totalSportMatches,
    performanceScore,
    hasPerformanceStar,
    isReady
  };
}

/**
 * Optimized Batch Player Metrics Enrichment
 * Computes attendance %, matches played, and trial readiness for an array of players in bulk.
 * Avoids N*M roundtrips to the database.
 */
async function enrichPlayersBatch(players) {
  if (!players || !players.length) return [];
  const playerIds = players.map(p => p._id);
  const sports = [...new Set(players.map(p => p.sport).filter(Boolean))];
  const coachIds = [...new Set(players.map(p => (p.coach?._id || p.coach)?.toString()).filter(Boolean))];

  // 1. Fetch all finalized sessions for these coaches
  const sessions = await Session.find({
    coach: { $in: coachIds },
    saved: true,
    'attendance.player': { $in: playerIds }
  }).lean();

  // 2. Fetch all match participations for these players
  const participations = await MatchParticipation.find({
    player: { $in: playerIds }
  }).populate('match', 'title sport date time opponent venue status hasConflict conflictMessage').lean();

  // 3. Count total sport matches per sport
  const sportMatchCounts = {};
  for (const sp of sports) {
    sportMatchCounts[sp] = await Match.countDocuments({
      sport: sportRegex(sp),
      status: 'completed'
    });
  }

  // 4. Also fetch legacy matches if any
  const countedMatchIds = new Set();
  for (const part of participations) {
    if (part.match && part.match._id) countedMatchIds.add(part.match._id.toString());
  }

  const legacyMatches = await Match.find({
    _id: { $nin: Array.from(countedMatchIds) },
    'entries.player': { $in: playerIds }
  }).lean();

  // Pre-load any linked sessions for legacy matches
  const legacySessionIds = legacyMatches.map(lm => lm.sessionId).filter(Boolean);
  const legacySessions = legacySessionIds.length ? await Session.find({ _id: { $in: legacySessionIds }, saved: true }).lean() : [];
  const legacySessionsMap = new Map(legacySessions.map(s => [s._id.toString(), s]));

  // Build maps
  const sessionsByPlayer = new Map();
  for (const s of sessions) {
    for (const a of s.attendance || []) {
      const pid = (a.player?._id || a.player)?.toString();
      if (!sessionsByPlayer.has(pid)) sessionsByPlayer.set(pid, []);
      sessionsByPlayer.get(pid).push({
        sessionId: s._id,
        date: s.date,
        sport: s.sport,
        status: a.status || 'absent',
        participation: a.participation || 'both',
        saved: !!s.saved,
        locked: !!s.locked
      });
    }
  }

  const partsByPlayer = new Map();
  for (const part of participations) {
    const pid = (part.player?._id || part.player)?.toString();
    if (!partsByPlayer.has(pid)) partsByPlayer.set(pid, []);
    partsByPlayer.get(pid).push(part);
  }

  const legacyByPlayer = new Map();
  for (const lm of legacyMatches) {
    for (const entry of lm.entries || []) {
      const pid = (entry.player?._id || entry.player)?.toString();
      if (!legacyByPlayer.has(pid)) legacyByPlayer.set(pid, []);
      legacyByPlayer.get(pid).push({ match: lm, entry });
    }
  }

  return players.map(rawP => {
    const p = rawP.toObject ? rawP.toObject() : rawP;
    const pidStr = p._id.toString();

    const pSessions = (sessionsByPlayer.get(pidStr) || []).filter(s => {
      const sp = p.sport ? p.sport.trim().toLowerCase() : '';
      return s.sport && s.sport.trim().toLowerCase() === sp;
    });
    pSessions.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalSessions = pSessions.length;
    let presentCount = 0;
    for (const s of pSessions) {
      if (s.status === 'present') presentCount++;
    }

    const attendanceRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

    const pParts = partsByPlayer.get(pidStr) || [];
    let totalMatchesPlayed = 0;
    let totalMatchesSelected = 0;
    let totalMatchesNotPlayed = 0;
    let conflictedMatchesCount = 0;
    const matchHistory = [];

    for (const part of pParts) {
      const m = part.match;
      if (!m) continue;
      if (m.status !== 'cancelled') totalMatchesSelected++;
      if (m.status === 'completed') {
        const isConflicted = !!part.attendanceConflict;
        if (isConflicted) conflictedMatchesCount++;
        if (part.played === true) {
          if (!isConflicted) totalMatchesPlayed++;
        } else if (part.played === false) {
          totalMatchesNotPlayed++;
        }
        matchHistory.push({
          matchId: m._id,
          title: m.title,
          sport: m.sport,
          date: m.date,
          time: m.time,
          opponent: m.opponent,
          venue: m.venue,
          played: part.played,
          score: part.score,
          remarks: part.remarks || '',
          attendanceConflict: isConflicted,
          conflictReason: part.conflictReason || ''
        });
      }
    }

    const pLegacies = legacyByPlayer.get(pidStr) || [];
    for (const item of pLegacies) {
      const lm = item.match;
      const entry = item.entry;
      if (lm.status === 'cancelled') continue;
      totalMatchesSelected++;

      if (entry.result === 'played') {
        let legacyConflict = false;
        if (lm.sessionId) {
          const linkedSession = legacySessionsMap.get(lm.sessionId.toString());
          if (linkedSession) {
            const sEntry = (linkedSession.attendance || []).find(
              a => (a.player?._id || a.player)?.toString() === pidStr
            );
            if (!sEntry || sEntry.status === 'absent') {
              legacyConflict = true;
            }
          }
        }

        if (!legacyConflict) {
          totalMatchesPlayed++;
        } else {
          conflictedMatchesCount++;
        }

        matchHistory.push({
          matchId: lm._id,
          title: lm.title || `Match vs ${lm.opponent}`,
          sport: lm.sport,
          date: lm.date,
          time: lm.time || '10:00',
          opponent: lm.opponent,
          venue: lm.venue || 'Main Stadium',
          played: true,
          score: entry.score,
          remarks: '',
          attendanceConflict: legacyConflict,
          conflictReason: legacyConflict ? 'Player marked absent in linked attendance session' : ''
        });
      } else {
        totalMatchesNotPlayed++;
      }
    }

    matchHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalSportMatches = sportMatchCounts[p.sport] || 0;
    const isAttendanceReady = totalSessions > 0 && (presentCount * 4 >= totalSessions * 3);
    const isMatchesReady = totalMatchesPlayed >= 2;
    const isReady = isAttendanceReady && isMatchesReady;

    // Performance score calculation:
    // Count only actual Played match records (excluding Did Not Play or conflicted matches)
    const scoredMatches = matchHistory.filter(
      m => m.played === true && !m.attendanceConflict && m.score !== null && m.score !== undefined
    );
    let performanceScore = null;
    if (typeof p.performanceScore === 'number') {
      performanceScore = p.performanceScore;
    } else if (scoredMatches.length > 0) {
      const totalScore = scoredMatches.reduce((acc, m) => acc + Number(m.score), 0);
      performanceScore = Math.round((totalScore / scoredMatches.length) * 10) / 10;
    }
    const hasPerformanceStar = typeof performanceScore === 'number' && performanceScore >= 15;

    return {
      ...p,
      playerId: p.playerId || p.username || '',
      username: p.username || p.playerId || '',
      attendanceRate,
      presentSessions: presentCount,
      totalSessions: totalSessions,
      attendanceHistory: pSessions,
      matchesPlayed: totalMatchesPlayed,
      matchCount: totalMatchesPlayed,
      totalMatchesPlayed,
      totalMatchesSelected,
      totalMatchesNotPlayed,
      conflictedMatchesCount,
      matchHistory,
      totalSportMatches,
      performanceScore,
      hasPerformanceStar,
      isReady
    };
  });
}

module.exports = {
  calculateSessionAttendance,
  calculateSessionTurnout,
  calculateIndividualAttendance,
  calculateMatchesPlayed,
  checkTrialReadiness,
  syncSessionMatchConflicts,
  enrichPlayer,
  enrichPlayersBatch
};
