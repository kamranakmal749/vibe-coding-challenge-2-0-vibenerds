// client/src/app/api/admin/audit/route.ts
import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';

const AuditLog = require('@/lib/models/AuditLog');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit
 * Fetches paginated administrative audit logs sorted newest first.
 * Strictly admin-only; never returns passwords.
 * Query params: page (default 1), limit (default 50, max 100), action (optional filter).
 */
export async function GET(req: Request) {
  const auth = await authenticateRequest(req, ['admin']);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    await connectToDatabase();

    const url = new URL(req.url);
    const pageParam = parseInt(url.searchParams.get('page') || '1', 10);
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
    const actionParam = url.searchParams.get('action')?.trim();

    const page = Math.max(1, isNaN(pageParam) ? 1 : pageParam);
    const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 50 : limitParam));
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (actionParam && actionParam !== 'all') {
      filter.action = actionParam;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    const sanitizedLogs = logs.map((log: any) => ({
      id: log._id.toString(),
      _id: log._id.toString(),
      action: log.action,
      actorId: log.actorId?.toString() || log.adminId?.toString() || 'admin',
      actorName: log.actorName || log.adminName || 'Admin',
      actorRole: log.actorRole || 'admin',
      actorEmail: log.actorEmail || '',
      targetType: log.targetType || 'System',
      targetId: log.targetId ? log.targetId.toString() : null,
      targetName: log.targetName || '',
      details: log.details || {},
      timestamp: log.timestamp || log.createdAt,
    }));

    return NextResponse.json({
      logs: sanitizedLogs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
