import { NextRequest, NextResponse } from 'next/server';
import {
  getVirtualPortfolioSummary,
  checkAndCloseTrades,
  listOpenTrades,
  listClosedTrades,
  openVirtualTrade,
} from '@/lib/simulation-service';
import { APP_CONFIG } from '@/lib/config';

/** Fetch current prices for symbols from Binance (read-only, no trading). */
async function fetchPricesForSymbols(symbols: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(symbols)].filter(Boolean);
  if (uniq.length === 0) return new Map();
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  try {
    const res = await fetch(
      `${base}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(uniq))}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return new Map();
    const data = (await res.json()) as Array<{ symbol?: string; price?: string }>;
    const map = new Map<string, number>();
    for (const row of data) {
      if (row.symbol && row.price) {
        const p = parseFloat(row.price);
        if (Number.isFinite(p)) map.set(row.symbol, p);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/portfolio/virtual
 * Returns virtual P&L summary and trades. Runs auto-close check with live prices (read-only fetch).
 */
export async function GET(): Promise<NextResponse> {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return NextResponse.json({
      totalVirtualBalancePct: 0,
      winRatePct: 0,
      dailyPnlPct: 0,
      openCount: 0,
      closedCount: 0,
      openTrades: [],
      closedTrades: [],
      message: 'DB_DRIVER=sqlite required.',
    });
  }

  const openTrades = listOpenTrades();
  const symbols = openTrades.map((t) => t.symbol);
  const prices = await fetchPricesForSymbols(symbols);
  const { closed: justClosed } = checkAndCloseTrades(prices);

  const summary = getVirtualPortfolioSummary();
  const closed = listClosedTrades(100);

  if (justClosed > 0 && summary.closedCount >= 5) {
    import('@/lib/ai-retrospective').then(({ runRetrospectiveAndReport }) => {
      runRetrospectiveAndReport().catch(() => {});
    });
  }

  return NextResponse.json({
    ...summary,
    openTrades: listOpenTrades(),
    closedTrades: closed,
  });
}

/**
 * POST /api/portfolio/virtual
 * Open a virtual trade (mock execution). Body: { symbol, entry_price, amount_usd [, target_profit_pct, stop_loss_pct ] }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return NextResponse.json({ success: false, error: 'DB_DRIVER=sqlite required.' }, { status: 400 });
  }

  let body: { symbol?: string; entry_price?: number; amount_usd?: number; target_profit_pct?: number; stop_loss_pct?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
  const entryPrice = typeof body.entry_price === 'number' ? body.entry_price : Number(body.entry_price);
  const amountUsd = typeof body.amount_usd === 'number' ? body.amount_usd : Number(body.amount_usd);

  if (!symbol || !Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ success: false, error: 'symbol, entry_price, and amount_usd required and must be positive.' }, { status: 400 });
  }

  const normalizedSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;

  const result = openVirtualTrade({
    symbol: normalizedSymbol,
    entry_price: entryPrice,
    amount_usd: amountUsd,
    target_profit_pct: body.target_profit_pct,
    stop_loss_pct: body.stop_loss_pct,
  });

  if (result.success) {
    return NextResponse.json({ success: true, id: result.id });
  }
  return NextResponse.json({ success: false, error: result.error }, { status: 400 });
}
