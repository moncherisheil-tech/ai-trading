import { NextRequest, NextResponse } from 'next/server';
import { isAllowedIp } from '@/lib/security';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

const SYMBOLS_TO_VERIFY = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines';

export async function GET(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  if (isSessionEnabled()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'viewer')) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const results: Record<string, { ok: boolean; error?: string }> = {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    await Promise.all(
      SYMBOLS_TO_VERIFY.map(async (symbol) => {
        try {
          const url = `${BINANCE_KLINES}?symbol=${symbol}&interval=1d&limit=1`;
          const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) {
            results[symbol] = { ok: false, error: `HTTP ${res.status}` };
            return;
          }
          const data = await res.json();
          const hasCandle = Array.isArray(data) && data.length > 0 && Array.isArray(data[0]);
          results[symbol] = hasCandle ? { ok: true } : { ok: false, error: 'No kline data' };
        } catch (e) {
          results[symbol] = {
            ok: false,
            error: e instanceof Error ? e.message : 'Request failed',
          };
        }
      })
    );
    clearTimeout(timeout);
    const allOk = SYMBOLS_TO_VERIFY.every((s) => results[s].ok);
    return NextResponse.json({
      success: true,
      symbols: results,
      allSymbolsReady: allOk,
      message: allOk
        ? 'כל המטבעות (BTC, ETH, SOL) זמינים לחיזוי.'
        : 'חלק מהמטבעות לא זמינים – בדוק חיבור ל-Binance.',
    });
  } catch (e) {
    clearTimeout(timeout);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Verification failed',
        symbols: results,
      },
      { status: 200 }
    );
  }
}
