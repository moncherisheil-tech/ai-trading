/**
 * GET /api/overseer/context — Live system context for Overseer health banner (Master Command Center).
 * Returns global exposure, today PnL, MoE threshold, win rate. Requires admin when session enabled.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getSystemContextForChat } from '@/lib/system-overseer';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const context = await getSystemContextForChat();
    return NextResponse.json(context);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to get context';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
