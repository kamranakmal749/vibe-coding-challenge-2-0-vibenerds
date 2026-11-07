// src/models/User.js
// Covers all four roles: admin, coach, scout, player
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  // role determines which views/data the user can access
  role: {
    type: String,
    enum: ['admin', 'coach', 'scout', 'player'],
    required: true
  },
  // Only relevant when role === 'player'
  playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
  // Mandatory password change flag for temporary credentials
  mustChangePassword: { type: Boolean, default: false }
}, { timestamps: true });

// Hash password before save
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);

