/**
 * Paper Trading Simulator — virtual trades only. NO live exchange execution.
 * Tracks AI performance in real-time without financial risk.
 */

import {
  insertVirtualTrade,
  closeVirtualTrade,
  listOpenVirtualTrades,
  listClosedVirtualTrades,
  type VirtualPortfolioRow,
  type InsertVirtualTradeInput,
} from '@/lib/db/virtual-portfolio';
import { APP_CONFIG } from '@/lib/config';

/** Mock execution: records trade in virtual_portfolio only. No real order is sent. */
export function openVirtualTrade(params: InsertVirtualTradeInput): { success: boolean; id?: number; error?: string } {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return { success: false, error: 'DB_DRIVER=sqlite required for virtual portfolio.' };
  }
  if (!params.symbol || params.entry_price <= 0 || params.amount_usd <= 0) {
    return { success: false, error: 'Invalid symbol, entry_price, or amount_usd.' };
  }
  try {
    const id = insertVirtualTrade(params);
    return { success: true, id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to open virtual trade.';
    return { success: false, error: message };
  }
}

/** Close a single trade by id (mock: no real order). */
export function closeVirtualTradeById(id: number, exitPrice: number): { success: boolean; error?: string } {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return { success: false, error: 'DB_DRIVER=sqlite required.' };
  }
  try {
    closeVirtualTrade(id, exitPrice);
    return { success: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to close trade.';
    return { success: false, error: message };
  }
}

/**
 * Auto-close open trades when live price hits target profit or stop-loss.
 * Prices are passed in (e.g. from Binance API); NO live trading calls from this module.
 */
export function checkAndCloseTrades(livePrices: Map<string, number>): { closed: number } {
  if (APP_CONFIG.dbDriver !== 'sqlite') return { closed: 0 };
  const openTrades = listOpenVirtualTrades();
  let closed = 0;
  for (const trade of openTrades) {
    const price = livePrices.get(trade.symbol);
    if (price == null || price <= 0 || trade.entry_price <= 0) continue;
    const pct = ((price - trade.entry_price) / trade.entry_price) * 100;
    if (!Number.isFinite(pct)) continue;
    const hitTarget = trade.target_profit_pct != null && pct >= trade.target_profit_pct;
    const hitStop = trade.stop_loss_pct != null && pct <= trade.stop_loss_pct;
    if (hitTarget || hitStop) {
      closeVirtualTrade(trade.id, price);
      closed++;
    }
  }
  return { closed };
}

export function listOpenTrades(): VirtualPortfolioRow[] {
  return listOpenVirtualTrades();
}

export function listClosedTrades(limit = 200): VirtualPortfolioRow[] {
  return listClosedVirtualTrades(limit);
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

/**
 * Compute virtual P&L summary from closed and open trades.
 * Total virtual balance = cumulative % return from closed trades (simplified as sum of pnl_pct weighted by amount).
 * Win rate = % of closed trades with pnl_pct > 0.
 * Daily PnL = sum of pnl_pct for trades closed today.
 */
export function getVirtualPortfolioSummary(): VirtualPortfolioSummary {
  const closed = listClosedVirtualTrades(500);
  const open = listOpenVirtualTrades();

  const totalInvestedUsd = closed.reduce((acc, t) => acc + t.amount_usd, 0) + open.reduce((acc, t) => acc + t.amount_usd, 0);
  const totalRealizedPnlUsd = closed.reduce((acc, t) => {
    if (t.pnl_pct != null) return acc + (t.amount_usd * t.pnl_pct) / 100;
    return acc;
  }, 0);

  const wins = closed.filter((t) => t.pnl_pct != null && t.pnl_pct > 0).length;
  const winRatePct = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dailyClosed = closed.filter((t) => t.closed_at && new Date(t.closed_at) >= todayStart);
  const dailyPnlPct = dailyClosed.reduce((acc, t) => acc + (t.pnl_pct ?? 0), 0);

  const cumulativePct = totalInvestedUsd > 0 ? (totalRealizedPnlUsd / totalInvestedUsd) * 100 : 0;

  return {
    totalVirtualBalancePct: cumulativePct,
    winRatePct,
    dailyPnlPct,
    openCount: open.length,
    closedCount: closed.length,
    totalInvestedUsd,
    totalRealizedPnlUsd,
  };
}
