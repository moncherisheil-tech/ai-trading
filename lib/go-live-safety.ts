import type { AppSettings } from '@/lib/db/app-settings';
import { MAX_ACCOUNT_RISK_PER_TRADE } from '@/lib/trading/risk-manager';

export type GoLiveSafetyCheck = {
  id: 'slippage' | 'kelly' | 'stopLoss';
  label: string;
  ok: boolean;
  detail: string;
};

/**
 * Institutional pre-flight: slippage cap, Kelly cap exposure, mandatory stop-loss defaults.
 */
export function evaluateGoLiveSafety(settings: AppSettings): {
  allGreen: boolean;
  checks: GoLiveSafetyCheck[];
} {
  const slip = settings.trading?.maxSlippagePct ?? 0;
  const slippageOk = slip > 0 && slip <= 1.5;

  const stop = settings.risk?.defaultStopLossPct ?? 0;
  const stopLossOk = stop >= 0.25 && stop <= 25;

  const globalExp = settings.risk?.globalMaxExposurePct ?? 0;
  const conc = settings.risk?.singleAssetConcentrationLimitPct ?? 0;
  const kellyOk =
    globalExp >= 15 &&
    globalExp <= 90 &&
    conc >= 5 &&
    conc <= 40 &&
    MAX_ACCOUNT_RISK_PER_TRADE > 0 &&
    MAX_ACCOUNT_RISK_PER_TRADE <= 0.05;

  const checks: GoLiveSafetyCheck[] = [
    {
      id: 'slippage',
      label: 'Slippage cap',
      ok: slippageOk,
      detail: slippageOk
        ? `maxSlippagePct=${slip}% (within guard band)`
        : `maxSlippagePct=${slip}% — require (0, 1.5%]`,
    },
    {
      id: 'kelly',
      label: 'Kelly / exposure',
      ok: kellyOk,
      detail: kellyOk
        ? `globalMax=${globalExp}%, singleAsset=${conc}%, per-trade cap ≤5%`
        : `Tune globalMaxExposurePct (15–90) and singleAssetConcentrationLimitPct (5–40).`,
    },
    {
      id: 'stopLoss',
      label: 'Stop-loss default',
      ok: stopLossOk,
      detail: stopLossOk
        ? `defaultStopLossPct=${stop}%`
        : `defaultStopLossPct=${stop}% — require [0.25%, 25%]`,
    },
  ];

  return { allGreen: checks.every((c) => c.ok), checks };
}
