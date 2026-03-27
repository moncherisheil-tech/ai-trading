/**
 * Paper Trading Simulator — virtual trades only. NO live exchange execution.
 * Persisted in Vercel Postgres:
 * - Virtual trade rows are stored in the "virtual_portfolio" table (see lib/db/virtual-portfolio.ts).
 * All PnL, wallet and percentage math uses Decimal.js to avoid floating-point errors.
 */

import {
  insertVirtualTrade,
  closeVirtualTrade,
  getVirtualTradeById,
  listOpenVirtualTrades,
  listClosedVirtualTrades,
  patchVirtualTradeExecState,
  applyAgentScaleOutHalf,
  type VirtualPortfolioRow,
  type InsertVirtualTradeInput,
} from '@/lib/db/virtual-portfolio';
import { runPostMortemWithTimeout } from '@/lib/smart-agent';
import { getAppSettings } from '@/lib/db/app-settings';
import { APP_CONFIG } from '@/lib/config';
import { round2, toDecimal, applySlippage } from '@/lib/decimal';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';
import { fetchGemsTicker24hWithElite, type Ticker24hElite } from '@/lib/gem-finder';

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

/** Unrealized loss % at which position is auto-closed (simulated liquidation). */
const LIQUIDATION_PCT = APP_CONFIG.paperLiquidationPct ?? -75;

/** Mock execution: records trade in virtual_portfolio only. No real order is sent. Applies AppSettings defaults for SL/TP when not provided. */
export async function openVirtualTrade(params: InsertVirtualTradeInput): Promise<{ success: boolean; id?: number; error?: string }> {
  if (!usePostgres()) {
    return { success: false, error: 'DATABASE_URL (Vercel Postgres) required for virtual portfolio.' };
  }
  if (!params.symbol || params.entry_price <= 0 || params.amount_usd <= 0) {
    return { success: false, error: 'Invalid symbol, entry_price, or amount_usd.' };
  }
  try {
    const settings = await getAppSettings();
    if (params.source === 'agent' && !settings.execution.masterSwitchEnabled) {
      return { success: false, error: 'Autonomous execution is disabled by Master Switch.' };
    }
    const target_profit_pct =
      params.target_profit_pct != null ? params.target_profit_pct : settings.risk.defaultTakeProfitPct;
    const stop_loss_pct =
      params.stop_loss_pct != null
        ? params.stop_loss_pct
        : -Math.abs(settings.risk.defaultStopLossPct);
    const id = await insertVirtualTrade({
      ...params,
      target_profit_pct,
      stop_loss_pct,
    });
    return { success: true, id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to open virtual trade.';
    return { success: false, error: message };
  }
}

/** Close a single trade by id (mock: no real order). */
export async function closeVirtualTradeById(id: number, exitPrice: number): Promise<{ success: boolean; error?: string }> {
  if (!usePostgres()) {
    return { success: false, error: 'DATABASE_URL required.' };
  }
  try {
    await closeVirtualTrade(id, exitPrice);
    return { success: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to close trade.';
    return { success: false, error: message };
  }
}

/** Close first open trade for symbol (fetch live price, apply sell slippage). */
export async function closeVirtualTradeBySymbol(symbol: string): Promise<{ success: boolean; id?: number; error?: string }> {
  if (!usePostgres()) return { success: false, error: 'DATABASE_URL required.' };
  const normalized = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const open = await listOpenVirtualTrades();
  const trade = open.find((t) => t.symbol === normalized);
  if (!trade) return { success: false, error: 'אין פוזיציה פתוחה עבור סמל זה.' };
  const prices = await fetchBinanceTickerPrices([normalized], 10_000);
  const price = prices.get(normalized);
  if (price == null || price <= 0) return { success: false, error: 'לא התקבל מחיר לסגירה.' };
  const slippageBps = APP_CONFIG.paperSlippageBps ?? 5;
  const exitPrice = applySlippage(price, 'sell', slippageBps);
  try {
    await closeVirtualTrade(trade.id, exitPrice, 'manual');
    const closed = await getVirtualTradeById(trade.id);
    if (closed?.pnl_pct != null) {
      runPostMortemWithTimeout(closed, exitPrice, 'manual', closed.pnl_pct);
    }
    return { success: true, id: trade.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to close trade.';
    return { success: false, error: message };
  }
}

/** Close every open virtual position at market (bid + sell slippage). Institutional HARD KILL. */
export async function closeAllOpenVirtualTradesAtMarket(): Promise<{
  closed: number;
  errors: string[];
}> {
  if (!usePostgres()) return { closed: 0, errors: ['DATABASE_URL required.'] };
  const open = await listOpenVirtualTrades();
  if (open.length === 0) return { closed: 0, errors: [] };
  const symbols = [...new Set(open.map((t) => t.symbol))];
  const prices = await fetchBinanceTickerPrices(symbols, 25_000);
  const slippageBps = APP_CONFIG.paperSlippageBps ?? 5;
  let closed = 0;
  const errors: string[] = [];
  for (const trade of open) {
    const raw = prices.get(trade.symbol);
    if (raw == null || raw <= 0) {
      errors.push(`${trade.symbol}: no price`);
      continue;
    }
    const exitPrice = applySlippage(raw, 'sell', slippageBps);
    try {
      await closeVirtualTrade(trade.id, exitPrice, 'manual');
      const row = await getVirtualTradeById(trade.id);
      if (row?.pnl_pct != null) {
        runPostMortemWithTimeout(row, exitPrice, 'manual', row.pnl_pct);
      }
      closed++;
    } catch (e) {
      errors.push(`${trade.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { closed, errors };
}

/**
 * Auto-close open trades when live price hits target profit, stop-loss, or liquidation threshold.
 * Applies slippage to exit price (selling the long = worse price). Uses Decimal for PnL.
 */
function computeTrailingEffectiveStop(
  trade: VirtualPortfolioRow,
  pct: number,
  state: { scaleOutDone?: boolean; peakUnrealizedPct?: number; effectiveStopLossPct?: number }
): number {
  const baseSl = trade.stop_loss_pct;
  let eff = state.effectiveStopLossPct ?? baseSl;
  eff = Math.max(eff, baseSl);
  const tp = Math.max(0.05, trade.target_profit_pct);
  const peak = Math.max(state.peakUnrealizedPct ?? pct, pct);
  if (pct >= tp * 0.25) eff = Math.max(eff, Math.min(-0.15, baseSl * 0.55));
  if (pct >= tp * 0.5) eff = Math.max(eff, -0.03);
  if (pct >= tp * 0.75) eff = Math.max(eff, tp * 0.38);
  if (peak >= tp * 0.35) eff = Math.max(eff, peak - tp * 0.42);
  return eff;
}

export async function checkAndCloseTrades(livePrices: Map<string, number>): Promise<{ closed: number }> {
  if (!usePostgres()) return { closed: 0 };
  const openTrades = await listOpenVirtualTrades();
  const slippageBps = APP_CONFIG.paperSlippageBps ?? 5;
  let closed = 0;
  for (const trade of openTrades) {
    const price = livePrices.get(trade.symbol);
    if (price == null || price <= 0 || trade.entry_price <= 0) continue;
    const entry = toDecimal(trade.entry_price);
    if (entry.isZero()) continue;
    const pct = toDecimal(price).minus(entry).div(entry).times(100).toNumber();
    if (!Number.isFinite(pct)) continue;
    const hitLiquidation = pct <= LIQUIDATION_PCT;

    const st = trade.exec_state ?? {};
    const peak = Math.max(st.peakUnrealizedPct ?? pct, pct);
    const effStop =
      trade.source === 'agent'
        ? computeTrailingEffectiveStop(trade, pct, { ...st, peakUnrealizedPct: peak })
        : trade.stop_loss_pct;

    if (
      trade.source === 'agent' &&
      (peak !== st.peakUnrealizedPct || effStop !== (st.effectiveStopLossPct ?? trade.stop_loss_pct))
    ) {
      await patchVirtualTradeExecState(trade.id, { peakUnrealizedPct: peak, effectiveStopLossPct: effStop });
    }

    const hitTarget = trade.target_profit_pct != null && pct >= trade.target_profit_pct;
    const hitStop = effStop != null && pct <= effStop;

    if (hitLiquidation || hitTarget || hitStop) {
      const exitPrice = applySlippage(price, 'sell', slippageBps);
      const reason = hitLiquidation ? 'liquidation' : hitTarget ? 'take_profit' : 'stop_loss';
      await closeVirtualTrade(trade.id, exitPrice, reason);
      if (trade.source === 'agent') {
        const closedRow = await getVirtualTradeById(trade.id);
        const pnlPct = closedRow?.pnl_pct ?? 0;
        runPostMortemWithTimeout(closedRow ?? trade, exitPrice, reason, pnlPct);
      }
      closed++;
      continue;
    }

    if (trade.source === 'agent' && !st.scaleOutDone && trade.target_profit_pct != null && pct >= trade.target_profit_pct * 0.5) {
      await applyAgentScaleOutHalf(trade.id);
      await patchVirtualTradeExecState(trade.id, {
        scaleOutDone: true,
        peakUnrealizedPct: peak,
        effectiveStopLossPct: Math.max(effStop, -0.03),
      });
    }
  }
  return { closed };
}

export async function listOpenTrades(): Promise<VirtualPortfolioRow[]> {
  return listOpenVirtualTrades();
}

export async function listClosedTrades(limit = 200): Promise<VirtualPortfolioRow[]> {
  return listClosedVirtualTrades(limit);
}

/** Run one agent cycle: open virtual trades for Elite (עוצמתי) gems that don't already have an open position. */
export async function runAgentCycle(maxNewTrades = 5): Promise<{ opened: number; message: string }> {
  if (!usePostgres()) return { opened: 0, message: 'מסד נתונים לא זמין.' };
  const appSettings = await getAppSettings();
  if (!appSettings.execution.masterSwitchEnabled) {
    return { opened: 0, message: 'Master Switch is OFF. Autonomous cycle skipped.' };
  }
  const open = await listOpenVirtualTrades();
  const openSymbols = new Set(open.map((t) => t.symbol));
  const tickers = await fetchGemsTicker24hWithElite(undefined, 25);
  const eliteOnly = tickers.filter((t): t is Ticker24hElite => t.isElite === true);
  const amountUsd = appSettings.trading?.defaultTradeSizeUsd ?? appSettings.risk.defaultPositionSizeUsd ?? 100;
  let opened = 0;
  for (const t of eliteOnly) {
    if (openSymbols.has(t.symbol)) continue;
    if (opened >= maxNewTrades) break;
    if (!t.price || t.price <= 0) continue;
    const result = await openVirtualTrade({
      symbol: t.symbol,
      entry_price: t.price,
      amount_usd: amountUsd,
      source: 'agent',
    });
    if (result.success) {
      openSymbols.add(t.symbol);
      opened++;
    }
  }
  return {
    opened,
    message: opened > 0 ? `הסוכן פתח ${opened} עסקאות (אליטה).` : 'אין עסקאות אליטה חדשות לפתיחה.',
  };
}

export interface VirtualPortfolioSummary {
  totalVirtualBalancePct: number;
  winRatePct: number;
  dailyPnlPct: number;
  openCount: number;
  closedCount: number;
  totalInvestedUsd: number;
  totalRealizedPnlUsd: number;
}

export async function getVirtualPortfolioSummary(): Promise<VirtualPortfolioSummary> {
  const closed = await listClosedVirtualTrades(500);
  const open = await listOpenVirtualTrades();

  let totalInvestedUsd = toDecimal(0);
  for (const t of closed) totalInvestedUsd = totalInvestedUsd.plus(t.amount_usd);
  for (const t of open) totalInvestedUsd = totalInvestedUsd.plus(t.amount_usd);

  let totalRealizedPnlUsd = toDecimal(0);
  for (const t of closed) {
    if (t.pnl_net_usd != null && Number.isFinite(t.pnl_net_usd)) {
      totalRealizedPnlUsd = totalRealizedPnlUsd.plus(toDecimal(t.pnl_net_usd));
    } else if (t.pnl_pct != null) {
      totalRealizedPnlUsd = totalRealizedPnlUsd.plus(toDecimal(t.amount_usd).times(t.pnl_pct).div(100));
    }
  }

  const wins = closed.filter((t) => {
    const net = t.pnl_net_usd ?? (t.pnl_pct != null ? (t.amount_usd * t.pnl_pct) / 100 : null);
    return net != null && net > 0;
  }).length;
  const winRatePct =
    closed.length > 0 ? round2(toDecimal(wins).div(closed.length).times(100)) : 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dailyClosed = closed.filter((t) => t.closed_at && new Date(t.closed_at) >= todayStart);
  let dailyPnlPct = toDecimal(0);
  for (const t of dailyClosed) dailyPnlPct = dailyPnlPct.plus(t.pnl_pct ?? 0);

  const cumulativePct = totalInvestedUsd.gt(0)
    ? round2(totalRealizedPnlUsd.div(totalInvestedUsd).times(100))
    : 0;

  return {
    totalVirtualBalancePct: cumulativePct,
    winRatePct,
    dailyPnlPct: round2(dailyPnlPct),
    openCount: open.length,
    closedCount: closed.length,
    totalInvestedUsd: round2(totalInvestedUsd),
    totalRealizedPnlUsd: round2(totalRealizedPnlUsd),
  };
}
