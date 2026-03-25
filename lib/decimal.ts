/**
 * Institutional-grade decimal arithmetic.
 * All P&L, balance, fee and percentage calculations use Decimal to avoid
 * JavaScript floating-point errors. Output is rounded to 2 or 4 decimals for display/API.
 */
import Decimal from 'decimal.js';

/** Safe numeric input: null/undefined/NaN become 0 for Decimal ops. */
function safeNumeric(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value instanceof Decimal) return value.isFinite() ? value.toNumber() : 0;
  return 0;
}

/** Round to 2 decimal places (USD, percentages). Handles null/undefined/NaN → 0. */
export function round2(d: Decimal | number | string | null | undefined): number {
  return new Decimal(safeNumeric(d)).toDecimalPlaces(2).toNumber();
}

/** Round to 4 decimal places (prices, small fractions). Handles null/undefined/NaN → 0. */
export function round4(d: Decimal | number | string | null | undefined): number {
  return new Decimal(safeNumeric(d)).toDecimalPlaces(4).toNumber();
}

/** Convert to Decimal safely (handles number, string, existing Decimal, null/undefined/NaN → 0). */
export function toDecimal(value: Decimal | number | string | null | undefined): Decimal {
  if (value == null) return new Decimal(0);
  if (value instanceof Decimal) return value.isFinite() ? value : new Decimal(0);
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? new Decimal(n) : new Decimal(0);
}

/** Constants as Decimal for consistent arithmetic. */
export const D = {
  zero: new Decimal(0),
  hundred: new Decimal(100),
  thousand: new Decimal(1000),
  half: new Decimal(0.5),
  feePct: new Decimal(0.1),
  /** Maker/Taker simulation: 0.1% entry + 0.1% exit. */
  entryFeeRate: new Decimal(0.001),
  exitFeeRate: new Decimal(0.001),
  startingBalance: new Decimal(10000),
  basePositionUsd: new Decimal(1000),
};

/** Format as fiat: exactly 2 decimal places, no trailing zeros stripped. */
export function formatFiat(value: number | string | null | undefined): string {
  const n = safeNumeric(value);
  return new Decimal(n).toFixed(2);
}

/** Format crypto: 2–8 decimal places, trim trailing zeros, cap length. */
export function formatCrypto(value: number | string | null | undefined, maxDecimals = 8): string {
  const n = safeNumeric(value);
  if (n === 0) return '0.00';
  const d = new Decimal(n);
  const fixed = d.toFixed(maxDecimals);
  const trimmed = fixed.replace(/\.?0+$/, '');
  if (trimmed.length > 16) return d.toExponential(4);
  return trimmed;
}

// --- Symbol-based precision (crypto tick sizes) ---

const MAJOR_BASES = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'LTC', 'BCH', 'AVAX', 'DOT', 'LINK', 'ATOM', 'UNI', 'MATIC']);
const MEME_BASES = new Set(['SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'DOGE']);

/** Price decimals: majors 2, mid-caps 4, memecoins/micro 8. */
export function getPriceDecimals(symbol: string): number {
  const base = (symbol || '').replace(/USDT$/i, '').toUpperCase();
  if (MAJOR_BASES.has(base)) return 2;
  if (MEME_BASES.has(base)) return 8;
  return 4;
}

/** Amount decimals: majors/mid 6, memecoins 8. */
export function getAmountDecimals(symbol: string): number {
  const base = (symbol || '').replace(/USDT$/i, '').toUpperCase();
  if (MEME_BASES.has(base)) return 8;
  return 6;
}

/** Round a numeric value to symbol-appropriate decimals (price or amount). Never returns NaN. */
export function roundToSymbolDecimals(
  value: number | string | Decimal | null | undefined,
  symbol: string,
  kind: 'price' | 'amount'
): number {
  const n = safeNumeric(value);
  if (!Number.isFinite(n)) return 0;
  const decimals = kind === 'price' ? getPriceDecimals(symbol) : getAmountDecimals(symbol);
  return new Decimal(n).toDecimalPlaces(decimals).toNumber();
}

/** Format price for display by symbol (e.g. SHIB → 0.00000852, BTC → 43250.00). */
export function formatPriceForSymbol(value: number | string | null | undefined, symbol: string): string {
  const n = safeNumeric(value);
  if (n === 0) return '0.00';
  const decimals = getPriceDecimals(symbol);
  const d = new Decimal(n);
  const fixed = d.toFixed(decimals);
  const trimmed = fixed.replace(/\.?0+$/, '');
  if (trimmed.length > 16) return d.toExponential(4);
  return trimmed;
}

/** Format asset amount for display by symbol. */
export function formatAmountForSymbol(value: number | string | null | undefined, symbol: string): string {
  const n = safeNumeric(value);
  if (n === 0) return '0';
  const decimals = getAmountDecimals(symbol);
  const d = new Decimal(n);
  const fixed = d.toFixed(decimals);
  const trimmed = fixed.replace(/\.?0+$/, '');
  if (trimmed.length > 18) return d.toExponential(4);
  return trimmed;
}

/**
 * Market order slippage: buy executes higher, sell executes lower.
 * @param marketPrice - Last/mid price from feed.
 * @param side - 'buy' | 'sell'.
 * @param bps - Slippage in basis points (e.g. 5 = 0.05%).
 * @returns Execution price (never NaN; uses Decimal).
 */
export function applySlippage(
  marketPrice: number | string | Decimal | null | undefined,
  side: 'buy' | 'sell',
  bps: number
): number {
  const p = toDecimal(marketPrice);
  if (!p.gt(0) || !Number.isFinite(bps)) return p.toNumber();
  const bpsDecimal = new Decimal(bps).div(10000);
  const mult = side === 'buy' ? p.plus(p.times(bpsDecimal)) : p.minus(p.times(bpsDecimal));
  const out = mult.toNumber();
  return Number.isFinite(out) && out > 0 ? out : p.toNumber();
}
