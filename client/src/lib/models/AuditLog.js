// client/src/lib/models/AuditLog.js
// Persistent audit logging for administrative actions and system events
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  // Primary actor fields
  actorId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true,
  },
  actorName: {
    type: String,
    required: true,
    trim: true,
  },
  actorRole: {
    type: String,
    default: 'admin',
    trim: true,
  },
  actorEmail: {
    type: String,
    lowercase: true,
    trim: true,
    default: '',
  },
  // Legacy alias compatibility
  adminId: {
    type: mongoose.Schema.Types.Mixed,
    index: true,
  },
  adminName: {
    type: String,
    trim: true,
  },
  // Target entity
  targetType: {
    type: String,
    required: true,
    default: 'Staff',
    trim: true,
    index: true,
  },
  targetId: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
    index: true,
  },
  targetName: {
    type: String,
    default: '',
    trim: true,
  },
  // Freeform details (strictly sanitized of sensitive credentials)
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ip: {
    type: String,
    default: '',
  },
  userAgent: {
    type: String,
    default: '',
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, { timestamps: true });

// Pre-save hook: populate legacy aliases if not explicitly provided
auditLogSchema.pre('save', function () {
  if (this.actorId && !this.adminId) {
    this.adminId = this.actorId;
  }
  if (this.actorName && !this.adminName) {
    this.adminName = this.actorName;
  }
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
