import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const s1 = `import { fetchWithBackoff, fetchDxySnapshot } from '@/lib/api-utils';

export type S1MacroSnapshot = {
  m2YoYPercent: number | null;
  us2y10ySpreadPctPoints: number | null;
  dxy: number | null;
  summaryEn: string;
  updatedAt: string;
};

async function fredObs(seriesId: string, limit: number, apiKey: string): Promise<Array<{ value: string }>> {
  const url = \`https://api.stlouisfed.org/fred/series/observations?series_id=\${seriesId}&api_key=\${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=\${limit}\`;
  const res = await fetchWithBackoff(url, { cache: 'no-store', timeoutMs: 10_000, maxRetries: 2 });
  if (!res.ok) return [];
  const j = (await res.json()) as { observations?: Array<{ value: string }> };
  return Array.isArray(j.observations) ? j.observations : [];
}

function parseLatest(obs: Array<{ value: string }>): number | null {
  for (const o of obs) {
    const v = parseFloat(o.value);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/** S1: M2 YoY, US 2Y/10Y spread, DXY — macro liquidity context. */
export async function fetchS1MacroSatellite(): Promise<S1MacroSnapshot> {
  const updatedAt = new Date().toISOString();
  const key = process.env.FRED_API_KEY?.trim();
  let m2YoYPercent: number | null = null;
  let us2y10ySpreadPctPoints: number | null = null;
  let dxy: number | null = null;
  if (key) {
    try {
      const m2obs = await fredObs('M2SL', 14, key);
      const y2 = await fredObs('DGS2', 5, key);
      const y10 = await fredObs('DGS10', 5, key);
      const latestM2 = parseLatest(m2obs);
      const old = m2obs[12];
      const m2year = old ? parseFloat(old.value) : NaN;
      if (latestM2 != null && Number.isFinite(m2year) && m2year > 0) {
        m2YoYPercent = Math.round(((latestM2 - m2year) / m2year) * 10000) / 100;
      }
      const d2 = parseLatest(y2);
      const d10 = parseLatest(y10);
      if (d2 != null && d10 != null) us2y10ySpreadPctPoints = Math.round((d10 - d2) * 1000) / 1000;
    } catch {
      /* optional */
    }
  }
  try {
    const snap = await fetchDxySnapshot(8000).catch(() => null);
    if (snap?.value != null && snap.value >= 72 && snap.value <= 140) dxy = snap.value;
  } catch {
    /* */
  }
  const parts: string[] = [];
  if (m2YoYPercent != null) parts.push(\`M2 YoY ~\${m2YoYPercent}%\`);
  if (us2y10ySpreadPctPoints != null) parts.push(\`US 10Y-2Y \${us2y10ySpreadPctPoints}pp\`);
  if (dxy != null) parts.push(\`DXY \${dxy.toFixed(2)}\`);
  const summaryEn =
    parts.length > 0
      ? \`S1 Macro satellite: \${parts.join('; ')}.\`
      : 'S1 Macro satellite: set FRED_API_KEY for M2/yields; DXY when available.';
  return { m2YoYPercent, us2y10ySpreadPctPoints, dxy, summaryEn, updatedAt };
}
`;
fs.mkdirSync(path.join(root, "lib/satellites"), { recursive: true });
fs.writeFileSync(path.join(root, "lib/satellites/s1-macro.ts"), s1, "utf8");
console.log("ok");
