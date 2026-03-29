import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(root, 'lib/analysis-core.ts');
let s = fs.readFileSync(p, 'utf8');
const imp = "import { fetchS1MacroSatellite } from '@/lib/satellites/s1-macro';\nimport { buildS2MicroSatelliteSummary } from '@/lib/satellites/s2-microstructure';\nimport { augmentOrderBookWithDepthHints } from '@/lib/market/binance-depth-hints';\n";
if (!s.includes('fetchS1MacroSatellite')) {
  s = s.replace("} from '@/lib/api-utils';", "} from '@/lib/api-utils';\n" + imp);
}
const needle = "  const [orderBookDepth, macroContext, aggTrades] = await Promise.all([";
const idx = s.indexOf(needle);
if (idx < 0) { console.error('needle missing'); process.exit(1); }
const endNeedle = "        (macroContext!.btcDominancePct != null ? ` BTC dominance: ${macroContext!.btcDominancePct}%.` : ''));";
const endIdx = s.indexOf(endNeedle, idx);
if (endIdx < 0) { console.error('end missing'); process.exit(1); }
const endLen = endNeedle.length;
const before = s.slice(0, idx);
const after = s.slice(endIdx + endLen);
const mid = `  const [orderBookDepth, macroContext, aggTrades, s1Satellite] = await Promise.all([
    fetchBinanceOrderBookDepth(cleanSymbol, 50),
    useCachedMacro ? Promise.resolve(null) : fetchMacroContext(),
    fetchBinanceAggTrades(cleanSymbol, 500),
    useCachedMacro ? Promise.resolve(null) : fetchS1MacroSatellite(),
  ]);
  let depthResample = null;
  try {
    await new Promise((r) => setTimeout(r, 400));
    depthResample = await fetchBinanceOrderBookDepth(cleanSymbol, 50);
  } catch {
    /* optional second depth sample */
  }
  const orderBookSummary = augmentOrderBookWithDepthHints(
    summarizeOrderBookDepth(orderBookDepth, cleanSymbol),
    orderBookDepth,
    depthResample
  );
  const microstructureCore = await fetchMicrostructureSummary({
    trades: aggTrades,
    closes: klines1h.closes,
    volumes: klines1h.volumes,
  });
  const microstructure_signal = buildS2MicroSatelliteSummary({
    microstructureLine: microstructureCore,
    leviathanLine: leviathanSnapshot.institutionalWhaleContext ?? null,
    onchainMetricShift: leviathanSnapshot.institutionalWhaleContext ?? null,
  });
  const macroContextStr = useCachedMacro
    ? 'Global macro (cached for this cycle).'
    : (macroContext!.dxyNote +
        (macroContext!.fearGreedIndex != null ? \` Fear & Greed: \${macroContext!.fearGreedIndex} (\${macroContext!.fearGreedLabel ?? 'N/A'}).\` : '') +
        (macroContext!.btcDominancePct != null ? \` BTC dominance: \${macroContext!.btcDominancePct}%.\` : '') +
        (s1Satellite?.summaryEn ? \` \${s1Satellite.summaryEn}\` : ''));`;
s = before + mid + after;
fs.writeFileSync(p, s, 'utf8');
console.log('ok');
