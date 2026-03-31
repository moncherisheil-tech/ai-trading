/**
 * Production API Connectivity Verification
 * -----------------------------------------
 * Pings both CryptoQuant Pro (Exchange Inflow) and CoinMarketCap Pro endpoints.
 * Exits with code 0 on full success, 1 on any failure.
 *
 * Usage:
 *   npx ts-node scripts/verify-prod.ts
 *   (or via: tsx scripts/verify-prod.ts)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const COLOR = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
};

function pass(label: string, detail: string) {
  console.log(`${COLOR.green}✔ PASS${COLOR.reset}  ${COLOR.bold}${label}${COLOR.reset}  →  ${detail}`);
}

function fail(label: string, detail: string) {
  console.error(`${COLOR.red}✖ FAIL${COLOR.reset}  ${COLOR.bold}${label}${COLOR.reset}  →  ${detail}`);
}

function info(msg: string) {
  console.log(`${COLOR.cyan}ℹ${COLOR.reset}  ${msg}`);
}

function banner(title: string) {
  console.log(`\n${COLOR.bold}${COLOR.cyan}${'─'.repeat(56)}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.cyan}  ${title}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.cyan}${'─'.repeat(56)}${COLOR.reset}\n`);
}

interface CheckResult {
  name: string;
  passed: boolean;
  statusCode?: number;
  detail: string;
}

async function checkCryptoQuant(): Promise<CheckResult> {
  const name = 'CryptoQuant Pro — BTC Exchange Inflow';
  const apiKey = (process.env.CRYPTOQUANT_API_KEY ?? '').trim();

  if (!apiKey) {
    return { name, passed: false, detail: 'CRYPTOQUANT_API_KEY is not set in environment' };
  }

  info(`CRYPTOQUANT_API_KEY present: ${apiKey.slice(0, 8)}…`);

  const url = 'https://api.cryptoquant.com/v1/btc/exchange-flows/inflow';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return { name, passed: true, statusCode: res.status, detail: `HTTP ${res.status} OK` };
    }

    const body = await res.text().catch(() => '');
    return {
      name,
      passed: false,
      statusCode: res.status,
      detail: `HTTP ${res.status} — ${body.slice(0, 120)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, passed: false, detail: `Network error: ${msg}` };
  }
}

async function checkCMC(): Promise<CheckResult> {
  const name = 'CoinMarketCap Pro — BTC Quotes';
  const apiKey = (process.env.CMC_API_KEY ?? '').trim();

  if (!apiKey) {
    return { name, passed: false, detail: 'CMC_API_KEY is not set in environment' };
  }

  info(`CMC_API_KEY present: ${apiKey.slice(0, 8)}…`);

  const url =
    'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC&convert=USD';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      headers: { 'X-CMC_PRO_API_KEY': apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return { name, passed: true, statusCode: res.status, detail: `HTTP ${res.status} OK` };
    }

    const body = await res.text().catch(() => '');
    return {
      name,
      passed: false,
      statusCode: res.status,
      detail: `HTTP ${res.status} — ${body.slice(0, 120)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, passed: false, detail: `Network error: ${msg}` };
  }
}

async function main() {
  banner('Production API Connectivity Check');
  console.log(`  Server time : ${new Date().toISOString()}`);
  console.log(`  Node        : ${process.version}`);
  console.log(`  CWD         : ${process.cwd()}\n`);

  const results = await Promise.all([checkCryptoQuant(), checkCMC()]);

  console.log('');
  let allPassed = true;
  for (const r of results) {
    if (r.passed) {
      pass(r.name, r.detail);
    } else {
      fail(r.name, r.detail);
      allPassed = false;
    }
  }

  console.log('');
  if (allPassed) {
    console.log(
      `${COLOR.green}${COLOR.bold}ALL CHECKS PASSED — APIs are reachable from this server.${COLOR.reset}`
    );
    process.exit(0);
  } else {
    console.error(
      `${COLOR.red}${COLOR.bold}ONE OR MORE CHECKS FAILED — review the output above.${COLOR.reset}`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
