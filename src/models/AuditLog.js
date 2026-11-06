// src/models/AuditLog.js
// Persistent audit logging for critical administrative events (e.g., PLAYER_DELETED)
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['PLAYER_DELETED', 'USER_DELETED', 'DATA_PURGED'],
    default: 'PLAYER_DELETED',
    index: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  adminName: {
    type: String,
    required: true,
    trim: true
  },
  adminEmail: {
    type: String,
    lowercase: true,
    trim: true,
    default: ''
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  targetType: {
    type: String,
    required: true,
    default: 'Player'
  },
  details: {
    playerName: { type: String, required: true },
    playerSport: { type: String, default: '' },
    playerInternalId: { type: String, default: '' },
    username: { type: String, default: '' }
  },
  ip: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
