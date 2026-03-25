import type { BinanceDepthSnapshot } from '@/lib/api-utils';

const DEFAULT_SLIPPAGE_CAP = 0.001; // 0.1%

/**
 * Estimate average execution price impact vs mid for a market BUY consuming ask liquidity (USD notional).
 * Returns approximate slippage as fraction of mid (e.g. 0.0012 = 0.12%).
 */
export function estimateBuySlippageFraction(
  depth: BinanceDepthSnapshot | null,
  notionalUsd: number,
  midPrice: number
): number {
  if (!depth?.asks?.length || !Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(midPrice) || midPrice <= 0) {
    return 0.02; // conservative 2% if unknown — forces TWAP path
  }
  let remainingUsd = notionalUsd;
  let costUsd = 0;
  let qtyTotal = 0;
  for (const [pStr, qStr] of depth.asks) {
    const price = parseFloat(pStr);
    const qty = parseFloat(qStr);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    const levelUsd = price * qty;
    const takeUsd = Math.min(remainingUsd, levelUsd);
    const takeQty = takeUsd / price;
    costUsd += takeQty * price;
    qtyTotal += takeQty;
    remainingUsd -= takeUsd;
    if (remainingUsd <= 1e-8) break;
  }
  if (remainingUsd > 1e-2 || qtyTotal <= 0) {
    return 0.02;
  }
  const avgPrice = costUsd / qtyTotal;
  return Math.abs(avgPrice - midPrice) / midPrice;
}

/** Market SELL consuming bid liquidity (long exit). */
export function estimateSellSlippageFraction(
  depth: BinanceDepthSnapshot | null,
  notionalUsd: number,
  midPrice: number
): number {
  if (!depth?.bids?.length || !Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(midPrice) || midPrice <= 0) {
    return 0.02;
  }
  let remainingUsd = notionalUsd;
  let proceedsUsd = 0;
  let qtyTotal = 0;
  for (const [pStr, qStr] of depth.bids) {
    const price = parseFloat(pStr);
    const qty = parseFloat(qStr);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    const levelUsd = price * qty;
    const takeUsd = Math.min(remainingUsd, levelUsd);
    const takeQty = takeUsd / price;
    proceedsUsd += takeQty * price;
    qtyTotal += takeQty;
    remainingUsd -= takeUsd;
    if (remainingUsd <= 1e-8) break;
  }
  if (remainingUsd > 1e-2 || qtyTotal <= 0) return 0.02;
  const avgPrice = proceedsUsd / qtyTotal;
  return Math.abs(midPrice - avgPrice) / midPrice;
}

export function shouldUseStealthTwap(slippageFraction: number, cap: number = DEFAULT_SLIPPAGE_CAP): boolean {
  return slippageFraction > cap;
}

export function pickTwapSchedule(highSlippage: boolean): { durationMinutes: number; chunks: number } {
  if (highSlippage) {
    return { durationMinutes: 6, chunks: 10 };
  }
  return { durationMinutes: 1, chunks: 2 };
}
