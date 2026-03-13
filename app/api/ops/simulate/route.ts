import { NextRequest, NextResponse } from 'next/server';
import { isAllowedIp } from '@/lib/security';
import { runCryptoAnalysisCore } from '@/app/actions';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';

export async function POST(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  const secret = process.env.WORKER_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const bearerOk = secret && authHeader === `Bearer ${secret}`;

  const cookieToken = request.cookies.get('app_auth_token')?.value || '';
  const session = verifySessionToken(cookieToken);
  const sessionOk = isSessionEnabled() && session && hasRequiredRole(session.role, 'admin');

  if (!bearerOk && !sessionOk) {
    return NextResponse.json({ success: false, error: 'Unauthorized. Use Bearer token or admin session.' }, { status: 401 });
  }

  let body: { symbol?: string } = {};
  try {
    body = await request.json();
  } catch {
    // ignore
  }
  const raw = (body.symbol || 'BTC').trim().toUpperCase() || 'BTC';
  const symbol = raw.endsWith('USDT') ? raw : `${raw}USDT`;

  try {
    const result = await runCryptoAnalysisCore(symbol, { skipCache: true });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בניתוח';
    return NextResponse.json(
      { success: false, error: message },
      { status: 200 }
    );
  }
}
