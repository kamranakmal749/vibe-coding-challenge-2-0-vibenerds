// src/models/Player.js
// A player belongs to one academy (one coach).
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Player name is required'], 
    trim: true 
  },
  age: { 
    type: Number, 
    required: [true, 'Age is required'], 
    min: [5, 'Age must be at least 5'], 
    max: [50, 'Age cannot exceed 50'] 
  },
  sport: { 
    type: String, 
    required: [true, 'Sport is required'], 
    trim: true 
  },
  registeredOn: { 
    type: Date, 
    required: [true, 'Date of registration is required'], 
    default: Date.now,
    validate: {
      validator: function(val) {
        if (!val) return false;
        // Date must not be in the future (allow 1 minute tolerance for clock skew)
        return new Date(val).getTime() <= Date.now() + 60000;
      },
      message: 'Date of registration cannot be in the future'
    }
  },
  defaultParticipation: { 
    type: String, 
    enum: {
      values: ['practice', 'match', 'both'],
      message: 'defaultParticipation must be practice, match, or both'
    }, 
    default: 'both' 
  },
  // Permanent unique player identifier (e.g. md260001)
  playerId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    index: true
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    index: true
  },
  // The coach who registered this player
  coach: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: [true, 'Coach reference is required'] 
  }
}, { timestamps: true });

// Pre-save hook: auto-assign permanent unique playerId if not present
playerSchema.pre('save', async function () {
  if (!this.playerId) {
    const { generatePlayerId } = require('../utils/idGenerator');
    const generated = await generatePlayerId(this.registeredOn || new Date());
    this.playerId = generated;
    this.username = generated;
  } else if (!this.username) {
    this.username = this.playerId;
  }
});

module.exports = mongoose.model('Player', playerSchema);
