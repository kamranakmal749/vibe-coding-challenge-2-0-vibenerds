// src/models/MatchParticipation.js
const mongoose = require('mongoose');

const matchParticipationSchema = new mongoose.Schema({
  match: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Match', 
    required: [true, 'Match reference is required'] 
  },
  player: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Player', 
    required: [true, 'Player reference is required'] 
  },
  played: { 
    type: Boolean, 
    default: null // null = selected but not yet marked; true = Yes; false = No
  },
  score: { 
    type: Number, 
    default: null,
    min: [0, 'Score must be at least 0'],
    max: [20, 'Score cannot exceed 20']
  },
  remarks: { 
    type: String, 
    trim: true, 
    default: '' 
  },
  // Attendance synchronization conflict tracking (Phase 4)
  attendanceConflict: {
    type: Boolean,
    default: false
  },
  conflictReason: {
    type: String,
    trim: true,
    default: ''
  }
}, { timestamps: true });

// Prevent duplicate participation entries for the same player in the same match
matchParticipationSchema.index({ match: 1, player: 1 }, { unique: true });

module.exports = mongoose.model('MatchParticipation', matchParticipationSchema);

