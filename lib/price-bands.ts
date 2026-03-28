/**
 * Spot price sanity bands (USD quote) for major pairs — shared by sanitization and ops simulations.
 */

export const SYMBOL_PRICE_BANDS_USD: Record<string, { min: number; max: number }> = {
  BTCUSDT: { min: 5_000, max: 2_000_000 },
  ETHUSDT: { min: 100, max: 500_000 },
  SOLUSDT: { min: 1, max: 50_000 },
  BNBUSDT: { min: 5, max: 50_000 },
  XRPUSDT: { min: 0.0001, max: 500 },
  ADAUSDT: { min: 0.0001, max: 50 },
  DOGEUSDT: { min: 0.00001, max: 50 },
  AVAXUSDT: { min: 0.1, max: 50_000 },
  DOTUSDT: { min: 0.01, max: 50_000 },
  LINKUSDT: { min: 0.01, max: 50_000 },
};

export const DEFAULT_PRICE_BAND_USD = { min: 1e-12, max: 1e15 };

function normSymbol(s: string): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function bandForSymbol(symbol: string): { min: number; max: number } {
  const key = normSymbol(symbol);
  return SYMBOL_PRICE_BANDS_USD[key] ?? DEFAULT_PRICE_BAND_USD;
}
