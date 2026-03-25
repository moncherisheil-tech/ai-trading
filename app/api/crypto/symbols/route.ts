import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBackoff } from '@/lib/api-utils';
import { APP_CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/crypto/symbols?q=BT
 * Returns Binance USDT pairs matching query (for autocomplete).
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim().toUpperCase();
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/exchangeInfo`;

  try {
    const res = await fetchWithBackoff(url, {
      timeoutMs: APP_CONFIG.fetchTimeoutMs,
      maxRetries: 3,
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ symbols: [] });
    const data = (await res.json()) as { symbols?: Array<{ symbol: string; status?: string }> };
    const list = (data.symbols || [])
      .filter((s) => s.symbol.endsWith('USDT') && s.status === 'TRADING')
      .map((s) => s.symbol)
      .sort();
    const filtered = q
      ? list.filter((s) => s.replace('USDT', '').startsWith(q) || s.toLowerCase().includes(q.toLowerCase()))
      : list.slice(0, 100);
    return NextResponse.json({ symbols: filtered.slice(0, 30) });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to fetch symbols';
    return NextResponse.json({ error: message, symbols: [] }, { status: 500 });
  }
}
