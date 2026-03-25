/**
 * Loads .env via Next, then runs LIVE 5-candle Dec 2025 alpha (real Gemini consensus).
 * Usage: npx tsx scripts/live-alpha-5candle.ts
 */

import { loadEnvConfig } from '@next/env';
import { runLiveAlphaFirstCandlesDec2025 } from '../lib/ops/live-alpha-5candle-dec2025';

loadEnvConfig(process.cwd());

async function main() {
  const n = Math.min(50, Math.max(1, parseInt(process.argv[2] || '5', 10) || 5));
  console.log(`[live-alpha] Starting ${n}-candle Dec 2025 BTC/USDT stress test (real runConsensusEngine)…`);
  const result = await runLiveAlphaFirstCandlesDec2025('BTCUSDT', n);
  console.log(JSON.stringify(result, null, 2));
  const actionable = result.rows.filter((r) => r.outcome !== 'SKIP').length;
  console.log(
    `\n[live-alpha] Summary: ${result.wins}W / ${result.losses}L / ${result.skipped} skip (neutral) | accuracy ${result.accuracyPct}% on ${actionable} directional calls`
  );
}

main().catch((e) => {
  console.error('[live-alpha] FAILED:', e);
  process.exit(1);
});
