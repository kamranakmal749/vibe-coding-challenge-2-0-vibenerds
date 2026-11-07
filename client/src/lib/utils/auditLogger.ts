// client/src/lib/utils/auditLogger.ts
import connectToDatabase from '@/lib/db';
const AuditLog = require('@/lib/models/AuditLog');

export interface AuditActionOptions {
  actorId: string | any;
  actorName: string;
  actorRole?: string;
  actorEmail?: string;
  action: string;
  targetType: 'Staff' | 'Player' | 'Session' | 'Match' | 'System';
  targetId?: string | any;
  targetName?: string;
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

const FORBIDDEN_KEY_REGEX = /password|secret|token|hash|credential|auth/i;

/**
 * Deeply sanitizes an object to ensure NO passwords, secrets, or tokens are ever logged.
 */
export function sanitizeAuditDetails(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeAuditDetails(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (FORBIDDEN_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeAuditDetails(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

/**
 * Records an immutable administrative audit log entry.
 */
export async function logAdminAction(options: AuditActionOptions) {
  try {
    await connectToDatabase();

    const sanitizedDetails = options.details ? sanitizeAuditDetails(options.details) : {};

    const entry = new AuditLog({
      actorId: options.actorId,
      actorName: options.actorName || 'Admin',
      actorRole: options.actorRole || 'admin',
      actorEmail: options.actorEmail || '',
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId || null,
      targetName: options.targetName || '',
      details: sanitizedDetails,
      ip: options.ip || '',
      userAgent: options.userAgent || '',
      timestamp: new Date(),
    });

    await entry.save();
    return entry;
  } catch (err: any) {
    // Non-blocking fallback so logging errors don't crash primary operations, but logged to stderr
    console.error('[AUDIT LOGGING ERROR]', err.message);
    return null;
  }
}
