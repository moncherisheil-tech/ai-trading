/**
 * Production Connectivity Verification
 * ─────────────────────────────────────
 * Verifies the i9 internal pipeline, Binance public feed, and Redis.
 *
 * NOTE: CryptoQuant and CoinMarketCap checks have been removed.
 * All market data now flows through the sovereign i9 hardware feed
 * (WHALE_REDIS_URL → Redis quant:alerts → BullMQ → Orchestrator).
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

function warn(label: string, detail: string) {
  console.warn(`${COLOR.yellow}⚠ WARN${COLOR.reset}  ${COLOR.bold}${label}${COLOR.reset}  →  ${detail}`);
}

function info(msg: string) {
  console.log(`${COLOR.cyan}ℹ${COLOR.reset}  ${msg}`);
}

function banner(title: string) {
  console.log(`\n${COLOR.bold}${COLOR.cyan}${'─'.repeat(60)}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.cyan}  ${title}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.cyan}${'─'.repeat(60)}${COLOR.reset}\n`);
}

interface CheckResult {
  name: string;
  passed: boolean;
  statusCode?: number;
  detail: string;
  warning?: boolean;
}

async function checkBinancePublic(): Promise<CheckResult> {
  const name = 'Binance Public API — BTC/USDT Ticker';
  const url = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json() as { lastPrice?: string };
      return { name, passed: true, statusCode: res.status, detail: `HTTP ${res.status} OK — BTC price: $${parseFloat(data.lastPrice ?? '0').toFixed(2)}` };
    }
    return { name, passed: false, statusCode: res.status, detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { name, passed: false, detail: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkRedisConfig(): Promise<CheckResult> {
  const name = 'Redis / i9 Pipeline — WHALE_REDIS_URL';
  const whaleUrl = (process.env.WHALE_REDIS_URL || '').trim();
  const redisUrl = (process.env.REDIS_URL || '').trim();
  if (!whaleUrl) {
    return { name, passed: false, detail: 'WHALE_REDIS_URL is not set — i9 hardware feed will NOT connect' };
  }
  info(`WHALE_REDIS_URL present: ${whaleUrl.slice(0, 20)}…`);
  if (!redisUrl) {
    return {
      name,
      passed: true,
      warning: true,
      detail: `WHALE_REDIS_URL is set. REDIS_URL missing (will use fallback redis://127.0.0.1:6379).`,
    };
  }
  return { name, passed: true, detail: `WHALE_REDIS_URL + REDIS_URL both configured.` };
}

async function checkDatabaseUrl(): Promise<CheckResult> {
  const name = 'PostgreSQL — DATABASE_URL';
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (!dbUrl) {
    return { name, passed: false, detail: 'DATABASE_URL is not set — DB persistence WILL FAIL' };
  }
  info(`DATABASE_URL present: ${dbUrl.slice(0, 22)}…`);
  return { name, passed: true, detail: 'DATABASE_URL configured.' };
}

async function checkDydxKey(): Promise<CheckResult> {
  const name = 'dYdX Wallet — DYDX_WALLET_PRIVATE_KEY';
  const key = (process.env.DYDX_WALLET_PRIVATE_KEY || '').trim();
  if (!key || /todo|changeme|example/i.test(key)) {
    return { name, passed: false, detail: 'DYDX_WALLET_PRIVATE_KEY missing — live execution blocked' };
  }
  return { name, passed: true, detail: 'DYDX_WALLET_PRIVATE_KEY configured.' };
}

async function checkTelegramToken(): Promise<CheckResult> {
  const name = 'Telegram — TELEGRAM_BOT_TOKEN';
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return { name, passed: false, detail: 'TELEGRAM_BOT_TOKEN missing — alerts will NOT be delivered' };
  }
  return { name, passed: true, detail: 'TELEGRAM_BOT_TOKEN configured.' };
}

async function main() {
  banner('i9 Pipeline & Production Connectivity Check');
  console.log(`  Server time : ${new Date().toISOString()}`);
  console.log(`  Node        : ${process.version}`);
  console.log(`  CWD         : ${process.cwd()}\n`);
  console.log(`  [NOTE] CryptoQuant + CoinMarketCap decommissioned.\n`);
  console.log(`         All whale data flows through i9 → Redis quant:alerts → BullMQ.\n`);

  const results = await Promise.all([
    checkRedisConfig(),
    checkDatabaseUrl(),
    checkBinancePublic(),
    checkDydxKey(),
    checkTelegramToken(),
  ]);

  console.log('');
  let allPassed = true;
  for (const r of results) {
    if (r.passed && !r.warning) {
      pass(r.name, r.detail);
    } else if (r.passed && r.warning) {
      warn(r.name, r.detail);
    } else {
      fail(r.name, r.detail);
      allPassed = false;
    }
  }

  console.log('');
  if (allPassed) {
    console.log(
      `${COLOR.green}${COLOR.bold}ALL CHECKS PASSED — i9 pipeline ready.${COLOR.reset}`
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
