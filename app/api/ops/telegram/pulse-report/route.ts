import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isSessionEnabled, verifySessionToken, hasRequiredRole } from '@/lib/session';
import { sendDailyPulseReport } from '@/lib/ops/telegram-reporter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.WORKER_CRON_SECRET || process.env.CRON_SECRET || '';
  if (!cronSecret) return false;

  const authHeader = request.headers.get('authorization');
  const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const { searchParams } = new URL(request.url);
  const tokenFromQuery = searchParams.get('secret') ?? '';
  const token = tokenFromHeader || tokenFromQuery;

  return token === cronSecret;
}

async function isAdminSession(): Promise<boolean> {
  if (!isSessionEnabled()) return false;
  const cookieStore = await cookies();
  const token = cookieStore.get('app_auth_token')?.value ?? '';
  const session = verifySessionToken(token);
  if (!session) return false;
  return hasRequiredRole(session.role, 'admin');
}

export async function GET(request: Request): Promise<NextResponse> {
  const cronOk = isCronAuthorized(request);
  const adminOk = await isAdminSession();

  if (!cronOk && !adminOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendDailyPulseReport();
    if (result.ok) {
      return NextResponse.json({ ok: true, message: 'Hedge Fund Pulse report sent to Telegram.' });
    }
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Unknown error' },
      { status: 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

