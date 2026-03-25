/**
 * GET: Simulation summary for PnlTerminal — persisted trades, wallet, open positions with live prices.
 * Uses fetchBinanceTickerPrices (fetchWithBackoff) for resilient price fetch.
 */

import { NextResponse } from 'next/server';
import { listSimulationTrades } from '@/lib/db/simulation-trades';
import { APP_CONFIG } from '@/lib/config';
import { round2, toDecimal, roundToSymbolDecimals, D } from '@/lib/decimal';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';

/** Single source of truth: same as PnL/reference capital (lib/decimal). */
const INITIAL_WALLET = D.startingBalance.toNumber();
const BINANCE_FETCH_TIMEOUT_MS = 10_000;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json({
      available: false,
      walletUsd: INITIAL_WALLET,
      trades: [],
      positions: [],
      totalUnrealizedPnlUsd: 0,
      simulationWinRatePct: 0,
      simulationMaxDrawdownPct: 0,
      simulationAvgRoiPerTradePct: 0,
      simulationRoundTripsCount: 0,
    });
  }
  try {
    const rows = await listSimulationTrades();
    const trades = rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      price: r.price,
      amountUsd: r.amount_usd,
      amountAsset: r.amount_asset,
      feeUsd: r.fee_usd,
      timestamp: r.timestamp,
      dateLabel: r.date_label,
    }));

    const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);
    let walletUsd = INITIAL_WALLET;
    let peak = INITIAL_WALLET;
    let simulationMaxDrawdownPct = 0;
    for (const t of sorted) {
      if (t.side === 'buy') {
        walletUsd = round2(toDecimal(walletUsd).minus(toDecimal(t.amount_usd).plus(t.fee_usd)));
      } else {
        walletUsd = round2(toDecimal(walletUsd).plus(toDecimal(t.amount_usd).minus(t.fee_usd)));
      }
      if (walletUsd > peak) peak = walletUsd;
      if (peak > 0) {
        const dd = ((peak - walletUsd) / peak) * 100;
        if (dd > simulationMaxDrawdownPct) simulationMaxDrawdownPct = round2(dd);
      }
    }

    const positionBySymbol = new Map<
      string,
      { amountAsset: number; buyAmount: number; buyCostUsd: number }
    >();
    for (const t of sorted) {
      const cur = positionBySymbol.get(t.symbol) ?? { amountAsset: 0, buyAmount: 0, buyCostUsd: 0 };
      if (t.side === 'buy') {
        cur.amountAsset += t.amount_asset;
        cur.buyAmount += t.amount_asset;
        cur.buyCostUsd += t.amount_usd + t.fee_usd;
      } else {
        cur.amountAsset -= t.amount_asset;
      }
      positionBySymbol.set(t.symbol, cur);
    }

    const symbolsWithPosition = [...positionBySymbol.entries()]
      .filter(([, p]) => p.amountAsset > 0)
      .map(([s]) => s);
    const prices = await fetchBinanceTickerPrices(symbolsWithPosition, BINANCE_FETCH_TIMEOUT_MS);

    // PnL = (CurrentPrice - EntryPrice)/EntryPrice * 100 - Fees%; Decimal used to 8 decimal places for precision
    const positions = symbolsWithPosition.map((symbol) => {
      const p = positionBySymbol.get(symbol)!;
      const currentPrice = prices.get(symbol) ?? 0;
      const avgEntry = p.buyAmount > 0 ? p.buyCostUsd / p.buyAmount : 0;
      const costUsd = avgEntry * p.amountAsset;
      const unrealizedPnlUsd = round2(
        toDecimal(currentPrice).minus(avgEntry).times(p.amountAsset).toDecimalPlaces(8)
      );
      return {
        symbol,
        amountAsset: roundToSymbolDecimals(p.amountAsset, symbol, 'amount'),
        costUsd: round2(costUsd),
        avgEntryPrice: roundToSymbolDecimals(avgEntry, symbol, 'price'),
        currentPrice: roundToSymbolDecimals(currentPrice, symbol, 'price'),
        unrealizedPnlUsd,
      };
    });

    const totalUnrealizedPnlUsd = round2(
      positions.reduce((s, p) => s + p.unrealizedPnlUsd, 0)
    );

    // God-Mode: Win Rate, Max Drawdown, Average ROI per round-trip (from paired buy/sell)
    const roundTrips: { pnlPct: number }[] = [];
    const buyQueueBySymbol = new Map<string, { price: number; amountAsset: number; costUsd: number; feeUsd: number }[]>();
    for (const t of sorted) {
      if (t.side === 'buy') {
        const q = buyQueueBySymbol.get(t.symbol) ?? [];
        q.push({
          price: t.price,
          amountAsset: t.amount_asset,
          costUsd: t.amount_usd + t.fee_usd,
          feeUsd: t.fee_usd,
        });
        buyQueueBySymbol.set(t.symbol, q);
      } else {
        const q = buyQueueBySymbol.get(t.symbol) ?? [];
        let toSell = t.amount_asset;
        const sellProceeds = t.amount_usd - t.fee_usd;
        while (toSell > 0 && q.length > 0) {
          const buy = q[0]!;
          const closeAmount = Math.min(toSell, buy.amountAsset);
          const costAlloc = (closeAmount / buy.amountAsset) * buy.costUsd;
          const pnlPct = buy.costUsd > 0 ? ((sellProceeds * (closeAmount / t.amount_asset) - costAlloc) / costAlloc) * 100 : 0;
          roundTrips.push({ pnlPct });
          buy.amountAsset -= closeAmount;
          buy.costUsd -= costAlloc;
          if (buy.amountAsset <= 0) q.shift();
          toSell -= closeAmount;
        }
      }
    }
    const completedRoundTrips = roundTrips.length;
    const wins = roundTrips.filter((r) => r.pnlPct > 0).length;
    const simulationWinRatePct = completedRoundTrips > 0 ? round2((wins / completedRoundTrips) * 100) : 0;
    const simulationAvgRoiPerTradePct = completedRoundTrips > 0 ? round2(roundTrips.reduce((s, r) => s + r.pnlPct, 0) / completedRoundTrips) : 0;

    return NextResponse.json({
      available: true,
      walletUsd: round2(walletUsd),
      trades,
      positions,
      totalUnrealizedPnlUsd,
      simulationWinRatePct,
      simulationMaxDrawdownPct,
      simulationAvgRoiPerTradePct,
      simulationRoundTripsCount: completedRoundTrips,
    });
  } catch {
    return NextResponse.json({
      available: false,
      walletUsd: INITIAL_WALLET,
      trades: [],
      positions: [],
      totalUnrealizedPnlUsd: 0,
      simulationWinRatePct: 0,
      simulationMaxDrawdownPct: 0,
      simulationAvgRoiPerTradePct: 0,
      simulationRoundTripsCount: 0,
    });
  }
}
