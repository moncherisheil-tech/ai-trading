import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';
import { buildAdminTerminalFeedPayload } from '@/lib/admin-terminal-feed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * CEO terminal JSON feed. Requires Bearer ADMIN_SECRET or x-cron-secret (same as middleware).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const data = await buildAdminTerminalFeedPayload();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Terminal feed failed';
    console.error('[api/admin/terminal]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
