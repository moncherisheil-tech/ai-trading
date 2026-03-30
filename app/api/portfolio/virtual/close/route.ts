import { NextRequest, NextResponse } from 'next/server';
import { closeVirtualTradeBySymbol } from '@/lib/simulation-service';
import { recordAuditLog } from '@/lib/db/audit-logs';
import { isSessionEnabled, verifySessionToken, hasRequiredRole } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

/**
 * POST /api/portfolio/virtual/close
 * Body: { symbol: string }. Closes first open virtual trade for that symbol (live price + sell slippage).
 * Requires valid session (viewer+) when APP_SESSION_SECRET is set.
 */
export async function POST(request: NextRequest) {
  if (isSessionEnabled()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'viewer')) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  let body: { symbol?: string };
  try {
    body = (await request.json()) as { symbol?: string };
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const rawSymbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const symbol = rawSymbol.slice(0, 20);
  if (!symbol) {
    return NextResponse.json({ success: false, error: 'symbol required.' }, { status: 400 });
  }
  const normalizedSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const result = await closeVirtualTradeBySymbol(normalizedSymbol);
  if (result.success) {
    await recordAuditLog({
      action_type: 'virtual_trade_close',
      actor_ip: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
      payload_diff: { symbol: normalizedSymbol, trade_id: result.id },
    });
    return NextResponse.json({ success: true, id: result.id });
  }
  return NextResponse.json({ success: false, error: result.error }, { status: 400 });
}
