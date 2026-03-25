/**
 * Daily CRON: record equity_value = cash + open_positions to portfolio_history.
 * Elite Terminal v1.3 — Equity Curve tracking.
 * Authorization: CRON_SECRET (Bearer or query secret=).
 */

import { NextResponse } from 'next/server';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { insertPortfolioHistorySnapshot } from '@/lib/db/portfolio-history';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';
import { APP_CONFIG } from '@/lib/config';
import { toDecimal, round2 } from '@/lib/decimal';
import { validateCronAuth } from '@/lib/cron-auth';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

const REF_LIQUID_USD = 10_000;

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json({ ok: true, skipped: true, message: 'Postgres not configured' });
  }

  try {
    const open = await listOpenVirtualTrades();
    let positionsValue = 0;
    if (open.length > 0) {
      const symbols = open.map((t) => t.symbol);
      const prices = await fetchBinanceTickerPrices(symbols, 8_000);
      let positionsSum = toDecimal(0);
      for (const t of open) {
        const price = prices.get(t.symbol) ?? t.entry_price;
        const entryD = toDecimal(t.entry_price);
        if (entryD.gt(0)) positionsSum = positionsSum.plus(toDecimal(t.amount_usd).times(price).div(entryD));
        else positionsSum = positionsSum.plus(t.amount_usd);
      }
      positionsValue = round2(positionsSum);
    }
    const equityValue = REF_LIQUID_USD + positionsValue;
    const id = await insertPortfolioHistorySnapshot(equityValue);
    return NextResponse.json({ ok: true, id, equity_value: equityValue });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron portfolio-snapshot] Error:', message);
    await sendWorkerFailureAlert('portfolio-snapshot', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
