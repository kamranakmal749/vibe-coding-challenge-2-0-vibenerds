// src/models/Match.js
const mongoose = require('mongoose');

const matchEntrySchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  result: { type: String, enum: ['played', 'did_not_play'], required: true },
  score:  { 
    type: Number, 
    default: null,
    min: [0, 'Score must be at least 0'],
    max: [20, 'Score cannot exceed 20']
  }
}, { _id: false });

const matchSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: [true, 'Match title is required'], 
    trim: true 
  },
  sport: { 
    type: String, 
    required: [true, 'Sport is required'], 
    trim: true 
  },
  date: { 
    type: Date, 
    required: [true, 'Match date is required'] 
  },
  time: { 
    type: String, 
    required: [true, 'Match time is required'] // "HH:mm", 24h
  },
  opponent: { 
    type: String, 
    required: [true, 'Opponent is required'], 
    trim: true 
  },
  venue: { 
    type: String, 
    required: [true, 'Venue is required'], 
    trim: true 
  },
  description: { 
    type: String, 
    trim: true, 
    default: '' 
  },
  status: { 
    type: String, 
    enum: ['upcoming', 'completed', 'cancelled'], 
    default: 'upcoming' 
  },
  coach: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: [true, 'Coach reference is required'] 
  },
  selectedPlayers: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Player' 
  }],
  maxSquadSize: {
    type: Number,
    default: 11,
    min: 1
  },
  sessionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Session', 
    default: null 
  },
  editUnlockedUntil: { 
    type: Date, 
    default: null 
  },
  // Attendance synchronization conflict tracking (Phase 4)
  hasConflict: {
    type: Boolean,
    default: false
  },
  conflictMessage: {
    type: String,
    trim: true,
    default: ''
  },
  // Backward compatibility entries array for legacy tests
  entries: [matchEntrySchema]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Unique compound index on (coach, date, time, sport, opponent)
// Prevents duplicate match entries for the same match per requirement 2.
matchSchema.index({ coach: 1, date: 1, time: 1, sport: 1, opponent: 1 }, { unique: true });

// Legacy `scores` virtual getter for backward compatibility
matchSchema.virtual('scores').get(function() {
  if (!this.entries) return [];
  return this.entries
    .filter(e => e.result === 'played')
    .map(e => ({ player: e.player, score: e.score }));
});

module.exports = mongoose.model('Match', matchSchema);
