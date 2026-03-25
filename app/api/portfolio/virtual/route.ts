import { NextRequest, NextResponse } from 'next/server';
import {
  getVirtualPortfolioSummary,
  checkAndCloseTrades,
  listOpenTrades,
  listClosedTrades,
  openVirtualTrade,
} from '@/lib/simulation-service';
import { getAppSettings } from '@/lib/db/app-settings';
import { APP_CONFIG } from '@/lib/config';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';
import { applySlippage } from '@/lib/decimal';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

function hasPostgresConfig(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

const BINANCE_FETCH_TIMEOUT_MS = 10_000;

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/portfolio/virtual
 * Returns virtual P&L summary and trades. Runs auto-close check with live prices (read-only fetch).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasPostgresConfig()) {
    return NextResponse.json({
      totalVirtualBalancePct: 0,
      winRatePct: 0,
      dailyPnlPct: 0,
      openCount: 0,
      closedCount: 0,
      openTrades: [],
      closedTrades: [],
      message: 'DATABASE_URL (Vercel Postgres) required.',
    });
  }

  const openTrades = await listOpenTrades();
  const symbols = openTrades.map((t) => t.symbol);
  const prices = await fetchBinanceTickerPrices(symbols, BINANCE_FETCH_TIMEOUT_MS);
  const { closed: justClosed } = await checkAndCloseTrades(prices);

  const [summary, closed] = await Promise.all([
    getVirtualPortfolioSummary(),
    listClosedTrades(100),
  ]);

  if (justClosed > 0 && summary.closedCount >= 5) {
    import('@/lib/ai-retrospective').then(({ runRetrospectiveAndReport }) => {
      void runRetrospectiveAndReport().catch(() => {});
    });
  }

  const openTradesFinal = await listOpenTrades();
  return NextResponse.json({
    ...summary,
    openTrades: openTradesFinal,
    closedTrades: closed,
  });
}

/**
 * POST /api/portfolio/virtual
 * Open a virtual trade (mock execution). Body: { symbol, entry_price, amount_usd [, target_profit_pct, stop_loss_pct ] }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasPostgresConfig()) {
    return NextResponse.json({ success: false, error: 'DATABASE_URL (Vercel Postgres) required.' }, { status: 400 });
  }

  let body: { symbol?: string; entry_price?: number; amount_usd?: number; target_profit_pct?: number; stop_loss_pct?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const rawSymbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const symbol = rawSymbol.slice(0, 20);
  let entryPrice = typeof body.entry_price === 'number' ? body.entry_price : Number(body.entry_price);
  let amountUsd = typeof body.amount_usd === 'number' ? body.amount_usd : Number(body.amount_usd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    const settings = await getAppSettings();
    amountUsd = settings.trading?.defaultTradeSizeUsd ?? settings.risk.defaultPositionSizeUsd ?? 100;
  }
  if (!symbol || amountUsd <= 0) {
    return NextResponse.json({ success: false, error: 'symbol and amount_usd required and must be positive.' }, { status: 400 });
  }

  const normalizedSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    const prices = await fetchBinanceTickerPrices([normalizedSymbol], BINANCE_FETCH_TIMEOUT_MS);
    entryPrice = prices.get(normalizedSymbol) ?? 0;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return NextResponse.json({ success: false, error: 'לא התקבל מחיר לסמל. נסה שוב.' }, { status: 400 });
    }
  }

  const slippageBps = APP_CONFIG.paperSlippageBps ?? 5;
  const entryPriceEffective = applySlippage(entryPrice, 'buy', slippageBps);

  const result = await openVirtualTrade({
    symbol: normalizedSymbol,
    entry_price: entryPriceEffective,
    amount_usd: amountUsd,
    target_profit_pct: body.target_profit_pct,
    stop_loss_pct: body.stop_loss_pct,
  });

  if (result.success) {
    return NextResponse.json({
      success: true,
      id: result.id,
      symbol: normalizedSymbol,
      entry_price: entryPriceEffective,
      amount_usd: amountUsd,
    });
  }
  return NextResponse.json({ success: false, error: result.error }, { status: 400 });
}
