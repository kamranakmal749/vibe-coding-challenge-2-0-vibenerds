// src/models/Session.js
// A session is an attendance roll for a particular date + sport.
const mongoose = require('mongoose');

const attendanceEntrySchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  status: { type: String, enum: ['present', 'absent'], default: 'present' },
  participation: { 
    type: String, 
    enum: ['practice', 'match', 'both', null], 
    default: 'both' 
  }
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  date:    { type: Date, required: true },
  sport:   { type: String, required: true, trim: true },
  coach:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  saved:   { type: Boolean, default: false },
  savedAt: { type: Date, default: null },
  locked:  { type: Boolean, default: false }, // Maintained for backwards compatibility
  attendance: {
    type: [attendanceEntrySchema],
    validate: {
      validator: function(entries) {
        if (!entries || !Array.isArray(entries)) return true;
        const seen = new Set();
        for (const e of entries) {
          const pid = (e.player?._id || e.player)?.toString();
          if (!pid) continue;
          if (seen.has(pid)) return false;
          seen.add(pid);
        }
        return true;
      },
      message: 'Duplicate attendance record for the same player in this session'
    }
  },
  // Immutable creation snapshot: tracks exact players present at session creation
  initialRosterPlayerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
  createdWithCount: { type: Number }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Automatically record savedAt timestamp when session is saved
sessionSchema.pre('save', function() {
  if (this.saved && !this.savedAt) {
    this.savedAt = new Date();
  }
});

// Server-derived session attendance figures. All clients should read these
// rather than recalculating turnout differently in each view.
sessionSchema.virtual('presentCount').get(function() {
  if (!this.attendance || this.attendance.length === 0) return 0;
  return this.attendance.filter(a => a.status === 'present').length;
});

sessionSchema.virtual('absentCount').get(function() {
  if (!this.attendance || this.attendance.length === 0) return 0;
  return this.attendance.filter(a => a.status === 'absent').length;
});

sessionSchema.virtual('totalCount').get(function() {
  if (this.attendance && this.attendance.length > 0) {
    return this.attendance.length;
  }
  return (this.initialRosterPlayerIds && this.initialRosterPlayerIds.length > 0)
    ? this.initialRosterPlayerIds.length
    : (this.createdWithCount || 0);
});

sessionSchema.virtual('attendanceRate').get(function() {
  if (!this.attendance || this.attendance.length === 0) return 0;
  const total = this.totalCount;
  return total > 0 ? Math.round((this.presentCount / total) * 100) : 0;
});

// Compound unique index on (coach, date, sport)
sessionSchema.index({ coach: 1, date: 1, sport: 1 }, { unique: true });
// Attendance lookups are player-centric and only ever include saved sessions.
sessionSchema.index({ coach: 1, sport: 1, saved: 1, 'attendance.player': 1 });

module.exports = mongoose.model('Session', sessionSchema);
