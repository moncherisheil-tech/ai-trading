import { NextRequest, NextResponse } from 'next/server';
import { isSessionEnabled, verifySessionToken, hasRequiredRole } from '@/lib/session';
import { listStrategyInsights, updateStrategyInsightStatus } from '@/lib/db/strategy-repository';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export async function GET() {
  const insights = await listStrategyInsights();
  return NextResponse.json({ success: true, data: insights });
}

export async function POST(request: NextRequest) {
  if (isSessionEnabled()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = (await request.json()) as { id?: string; status?: 'pending' | 'approved' | 'rejected' };
  if (!body.id || !body.status) {
    return NextResponse.json({ success: false, error: 'Missing id or status' }, { status: 400 });
  }

  await updateStrategyInsightStatus(body.id, body.status);
  return NextResponse.json({ success: true });
}

