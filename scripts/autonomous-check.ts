/**
 * Autonomous smoke + E2E gates for production (CEO / go-live).
 * - HTTP: /, /ops, /api/market/risk, /api/simulation/trades
 * - MoE: runMoEBoardSmokeTest() — all 8 experts must fulfill
 * - PM2: last ~100 lines of combined logs scanned for Error/Exception
 * - Static: ticker hook contains map-based deduplication markers
 *
 * Usage:
 *   npx tsx scripts/autonomous-check.ts
 *   VERIFY_BASE_URL=https://example.com npx tsx scripts/autonomous-check.ts
 *
 * Strict JSON 200 on gated APIs and real dashboard HTML requires a valid session:
 *   VERIFY_AUTH_COOKIE="<payload.sig>"   (or full quantum_auth_session=...)
 *
 * Without it, UI checks pass on 307→/login (auth gate), APIs pass on 401 (route exists).
 */

import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

function ok(msg: string) {
  console.log(`${C.green}PASS${C.reset}  ${msg}`);
}

function bad(msg: string) {
  console.error(`${C.red}FAIL${C.reset}  ${msg}`);
}

function warn(msg: string) {
  console.log(`${C.yellow}WARN${C.reset}  ${msg}`);
}

function baseUrl(): string {
  const u =
    process.env.VERIFY_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://127.0.0.1:3000';
  return u.replace(/\/$/, '');
}

/** Session value or full `quantum_auth_session=...` for real 200 checks on gated pages/APIs. */
function authHeaders(): Record<string, string> {
  const raw = process.env.VERIFY_AUTH_COOKIE?.trim();
  if (!raw) return {};
  const cookie = raw.includes('=') ? raw : `quantum_auth_session=${raw}`;
  return { Cookie: cookie, Accept: 'text/html,application/json,*/*' };
}

async function checkUiPage(label: string, url: string, expectedPath: string): Promise<boolean> {
  try {
    const hasCookie = Boolean(process.env.VERIFY_AUTH_COOKIE?.trim());
    if (hasCookie) {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: authHeaders(),
      });
      if (res.status !== 200) {
        bad(`${label} → ${res.status} ${url}`);
        return false;
      }
      const path = new URL(res.url).pathname;
      if (path !== expectedPath) {
        bad(`${label} → expected path ${expectedPath}, got ${path} (still on login?)`);
        return false;
      }
      ok(`${label} → 200 ${expectedPath}`);
      return true;
    }
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html,*/*' },
    });
    if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      const loc = res.headers.get('location') || '';
      if (/\/login/i.test(loc)) {
        ok(`${label} → ${res.status} auth gate → login (set VERIFY_AUTH_COOKIE for full 200)`);
        return true;
      }
    }
    if (res.status === 200) {
      ok(`${label} → 200 (open route)`);
      return true;
    }
    bad(`${label} → ${res.status} ${url}`);
    return false;
  } catch (e) {
    bad(`${label} → ${e instanceof Error ? e.message : String(e)} (${url})`);
    return false;
  }
}

async function checkApi(label: string, url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (res.status === 200) {
      ok(`${label} → 200`);
      return true;
    }
    if (res.status === 401 && !process.env.VERIFY_AUTH_COOKIE?.trim()) {
      ok(`${label} → 401 (route reachable; set VERIFY_AUTH_COOKIE for JSON 200)`);
      return true;
    }
    bad(`${label} → ${res.status} ${url}`);
    return false;
  } catch (e) {
    bad(`${label} → ${e instanceof Error ? e.message : String(e)} (${url})`);
    return false;
  }
}

function tickerDedupAudit(): boolean {
  const p = path.join(process.cwd(), 'hooks', 'use-binance-ticker.ts');
  if (!fs.existsSync(p)) {
    bad(`ticker dedup audit → missing ${p}`);
    return false;
  }
  const src = fs.readFileSync(p, 'utf8');
  const hasMap = src.includes('Map-based deduplication');
  const hasActiveSet = src.includes('activeSet') && src.includes('new Set(getActiveSymbols())');
  if (!hasMap || !hasActiveSet) {
    bad('ticker dedup audit → expected Map-based dedup + activeSet gate not found');
    return false;
  }
  ok('ticker dedup audit → Map-based symbol key + active Set gate present');
  return true;
}

function pm2LogAudit(): boolean {
  try {
    execSync('pm2 -v', { stdio: 'pipe', encoding: 'utf8' });
  } catch {
    warn('PM2 not available — skipping log audit');
    return true;
  }
  let out: string;
  try {
    out = execSync('pm2 logs --lines 100 --nostream 2>&1', {
      encoding: 'utf8',
      maxBuffer: 4_000_000,
      windowsHide: true,
    });
  } catch (e) {
    const msg = e instanceof Error && 'stdout' in e ? String((e as { stdout?: string }).stdout) : '';
    out = msg || (e instanceof Error ? e.message : String(e));
  }
  const lines = out.split(/\r?\n/);
  const hits = lines.filter((line) => /\b(Error|Exception)\b/i.test(line));
  if (hits.length > 0) {
    bad(`PM2 log audit → ${hits.length} line(s) mention Error/Exception (last 100 lines)`);
    for (const h of hits.slice(0, 15)) {
      console.error(`  ${h}`);
    }
    return false;
  }
  ok('PM2 log audit → no Error/Exception in last ~100 lines');
  return true;
}

async function main(): Promise<number> {
  console.log(`\n${C.bold}Autonomous check${C.reset}  base=${baseUrl()}\n`);

  let failed = false;

  if (!tickerDedupAudit()) failed = true;

  const b = baseUrl();
  if (!(await checkUiPage('UI /', `${b}/`, '/'))) failed = true;
  if (!(await checkUiPage('UI /ops', `${b}/ops`, '/ops'))) failed = true;
  if (!(await checkApi('API /api/market/risk', `${b}/api/market/risk`))) failed = true;
  if (!(await checkApi('API /api/simulation/trades', `${b}/api/simulation/trades`))) failed = true;

  if (process.env.SKIP_MOE_SMOKE === '1') {
    warn('MoE smoke skipped (SKIP_MOE_SMOKE=1)');
  } else {
    try {
      const { runMoEBoardSmokeTest } = await import('../lib/core/orchestrator');
      const moe = await runMoEBoardSmokeTest();
      if (!moe.ok) {
        bad(`MoE board → ${moe.succeeded}/8 experts OK; errors: ${moe.errors.join(' | ')}`);
        failed = true;
      } else {
        ok(`MoE board → all 8 experts fulfilled (${moe.succeeded} succeeded)`);
      }
    } catch (e) {
      bad(`MoE board → ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
    }
  }

  if (!pm2LogAudit()) failed = true;

  if (failed) {
    console.error(`\n${C.red}${C.bold}AUTONOMOUS CHECK: FAILED${C.reset}\n`);
    return 1;
  }
  console.log(`\n${C.green}${C.bold}AUTONOMOUS CHECK: PASSED${C.reset}\n`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
