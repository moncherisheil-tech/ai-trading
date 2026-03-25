/**
 * GET: Risk Pulse for header — exposure/concentration state (Green/Amber/Red).
 * Uses virtual portfolio open positions + ref liquid to compute allocation.
 * Thresholds from getAppSettings() when available; fallback to defaults.
 */

import { NextResponse } from 'next/server';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { getAppSettings } from '@/lib/db/app-settings';
import { computePortfolioAllocation } from '@/lib/portfolio-logic';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';
import { APP_CONFIG } from '@/lib/config';
import { toDecimal, round2 } from '@/lib/decimal';

const REF_LIQUID = 10_000;
const DEFAULT_EXPOSURE_AMBER = 50;
const DEFAULT_EXPOSURE_RED = 70;
const DEFAULT_CONCENTRATION_AMBER = 15;
const DEFAULT_CONCENTRATION_RED = 20;

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json({ level: 'green', totalExposurePct: 0, maxConcentrationPct: 0 });
  }
  try {
    let exposureRed = DEFAULT_EXPOSURE_RED;
    let exposureAmber = DEFAULT_EXPOSURE_AMBER;
    let concentrationRed = DEFAULT_CONCENTRATION_RED;
    let concentrationAmber = DEFAULT_CONCENTRATION_AMBER;
    try {
      const settings = await getAppSettings();
      exposureRed = settings.risk.globalMaxExposurePct ?? DEFAULT_EXPOSURE_RED;
      concentrationRed = settings.risk.singleAssetConcentrationLimitPct ?? DEFAULT_CONCENTRATION_RED;
      exposureAmber = Math.min(exposureRed - 1, 50);
      concentrationAmber = Math.min(concentrationRed - 1, 15);
    } catch {
      // use defaults
    }

    const open = await listOpenVirtualTrades();
    let positions: { symbol: string; currentValueUsd: number; amountAsset: number }[] = [];
    if (open.length > 0) {
      const prices = await fetchBinanceTickerPrices(open.map((t) => t.symbol), 5_000);
      positions = open.map((t) => {
        const price = prices.get(t.symbol) ?? t.entry_price;
        const entryD = toDecimal(t.entry_price);
        const amountUsdD = toDecimal(t.amount_usd);
        const currentValueUsd = entryD.gt(0) ? round2(amountUsdD.times(price).div(entryD)) : t.amount_usd;
        const amountAsset = entryD.gt(0) ? round2(amountUsdD.div(entryD)) : 0;
        return { symbol: t.symbol, currentValueUsd, amountAsset };
      });
    }
    const allocation = computePortfolioAllocation({ liquidBalanceUsd: REF_LIQUID, positions });
    const { totalExposurePct, assetConcentrationPct } = allocation;

    let level: 'green' | 'amber' | 'red' = 'green';
    if (totalExposurePct >= exposureRed || assetConcentrationPct >= concentrationRed) level = 'red';
    else if (totalExposurePct >= exposureAmber || assetConcentrationPct >= concentrationAmber) level = 'amber';

    return NextResponse.json({
      level,
      totalExposurePct: Math.round(totalExposurePct * 10) / 10,
      maxConcentrationPct: Math.round(assetConcentrationPct * 10) / 10,
    });
  } catch {
    return NextResponse.json({ level: 'green', totalExposurePct: 0, maxConcentrationPct: 0 });
  }
}
