// src/utils/coach.js
// Resolve which coach owns a player/session record.
const mongoose = require('mongoose');
const User = require('../models/User');

async function resolveCoachId(req, explicitCoachId) {
  if (req.user.role === 'coach') return req.user.id;

  if (explicitCoachId && mongoose.Types.ObjectId.isValid(explicitCoachId)) {
    const explicitCoach = await User.findOne({ _id: explicitCoachId, role: 'coach' }).select('_id');
    if (explicitCoach) return explicitCoach._id;
  }

  // Admin-created records must still belong to a coach, otherwise the coach
  // portal can never see the player or include them in attendance sessions.
  const firstCoach = await User.findOne({ role: 'coach' }).sort({ createdAt: 1 }).select('_id');
  return firstCoach ? firstCoach._id : null;
}

module.exports = { resolveCoachId };
