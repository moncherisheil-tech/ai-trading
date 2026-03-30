/**
 * GET: List audit logs for Admin System Audit view. Searchable by from_date, to_date, action_type.
 * Requires admin when session is enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { listAuditLogs } from '@/lib/db/audit-logs';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const from_date = searchParams.get('from_date') ?? undefined;
  const to_date = searchParams.get('to_date') ?? undefined;
  const action_type = searchParams.get('action_type') ?? undefined;
  const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100', 10) || 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

  try {
    const rows = await listAuditLogs({ from_date, to_date, action_type, limit, offset });
    return NextResponse.json({ success: true, logs: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to list audit logs';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
