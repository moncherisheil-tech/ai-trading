/**
 * CLEAN BOOT — sequential infrastructure verification (CEO / Workspace 2)
 * ───────────────────────────────────────────────────────────────────────
 * Runs strict, ordered checks so a single failure pinpoints which .env key to fix.
 * Does NOT import @/lib/config (avoids boot-time required-env throws before checks run).
 *
 * Usage:
 *   npx tsx scripts/verify-prod.ts
 *   npm run verify:prod
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import IORedis from 'ioredis';
import { Pool } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const COLOR = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function pass(step: string, label: string, detail: string) {
  console.log(
    `${COLOR.green}PASS${COLOR.reset}  ${COLOR.bold}[${step}] ${label}${COLOR.reset}  →  ${detail}`
  );
}

function fail(step: string, label: string, detail: string) {
  console.error(
    `${COLOR.red}FAIL${COLOR.reset}  ${COLOR.bold}[${step}] ${label}${COLOR.reset}  →  ${detail}`
  );
}

function skip(step: string, label: string, detail: string) {
  console.log(
    `${COLOR.yellow}SKIP${COLOR.reset}  ${COLOR.bold}[${step}] ${label}${COLOR.reset}  →  ${detail}`
  );
}

function banner(title: string) {
  console.log(`\n${COLOR.bold}${COLOR.cyan}${'═'.repeat(64)}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.cyan}  ${title}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.cyan}${'═'.repeat(64)}${COLOR.reset}\n`);
}

function stripEnvQuotes(raw: string | undefined): string {
  const v = (raw || '').trim();
  if (!v) return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function maskRedisUrl(url: string): string {
  return url.replace(/:\/\/([^:/?#]+):([^@]+)@/, '://$1:***@');
}

function isRedisAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes('WRONGPASS') ||
    msg.includes('NOAUTH') ||
    msg.includes('INVALID USERNAME-PASSWORD') ||
    msg.includes('AUTHENTICATION REQUIRED') ||
    msg.includes('ERR AUTH') ||
    msg.includes('DENIED BY ACL')
  );
}

async function testRedisPing(
  step: string,
  label: string,
  redisUrl: string | undefined,
  optional: boolean
): Promise<boolean> {
  const url = stripEnvQuotes(redisUrl);
  if (!url) {
    if (optional) {
      skip(step, label, 'Env var not set — optional for this check.');
      return true;
    }
    fail(step, label, 'URL is empty — set the variable in .env');
    return false;
  }

  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 8_000,
    lazyConnect: true,
    tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    if (pong !== 'PONG') {
      fail(step, label, `Unexpected PING reply: ${String(pong)}`);
      return false;
    }
    pass(step, label, `PING/PONG OK — ${maskRedisUrl(url)}`);
    return true;
  } catch (err) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (isRedisAuthError(err)) {
      fail(
        step,
        label,
        `[AUTH_ERROR] Invalid password, ACL, or TLS scheme. Use rediss:// if the host requires TLS. ${msg}`
      );
    } else {
      fail(step, label, msg);
    }
    return false;
  }
}

async function testPostgres(): Promise<boolean> {
  const step = '2';
  const label = 'PostgreSQL — DATABASE_URL';
  const cs = stripEnvQuotes(process.env.DATABASE_URL);
  if (!cs) {
    fail(step, label, 'DATABASE_URL is not set');
    return false;
  }

  const pool = new Pool({
    connectionString: cs,
    connectionTimeoutMillis: 12_000,
    max: 1,
    ssl: (() => {
      if (/127\.0\.0\.1|localhost|::1/.test(cs)) return false as const;
      try {
        const u = new URL(cs);
        const m = u.searchParams.get('sslmode')?.toLowerCase();
        if (m === 'require' || m === 'prefer' || m === 'verify-ca') {
          return { rejectUnauthorized: false as const };
        }
        if (m === 'verify-full') return { rejectUnauthorized: true as const };
      } catch {
        /* fall through */
      }
      return undefined;
    })(),
  });

  try {
    const r = await pool.query('SELECT 1 AS ok');
    const ok = Number((r.rows[0] as { ok?: number })?.ok) === 1;
    await pool.end();
    if (!ok) {
      fail(step, label, 'SELECT 1 returned unexpected row');
      return false;
    }
    pass(step, label, 'SELECT 1 OK — update password in .env if you see 28P01 elsewhere');
    return true;
  } catch (err) {
    await pool.end().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    if (/28P01|password authentication failed/i.test(msg)) {
      fail(
        step,
        label,
        'Authentication failed (28P01). Encode special chars in password: node -e "console.log(encodeURIComponent(\'YOUR_PW\'))"'
      );
    } else {
      fail(step, label, msg);
    }
    return false;
  }
}

async function testPinecone(): Promise<boolean> {
  const step = '3';
  const label = 'Pinecone — PINECONE_API_KEY + index';
  const apiKey = stripEnvQuotes(process.env.PINECONE_API_KEY);
  if (!apiKey) {
    skip(step, label, 'PINECONE_API_KEY unset — vector memory disabled; not a hard fail for MoE');
    return true;
  }

  let indexName = stripEnvQuotes(process.env.PINECONE_INDEX_NAME) || 'quantum-memory';
  if (/^\d+$/.test(indexName)) {
    indexName = 'quantum-memory';
  }

  try {
    const { Pinecone } = await import('@pinecone-database/pinecone');
    const pc = new Pinecone({ apiKey });
    const index = pc.index(indexName);
    await index.describeIndexStats();
    pass(step, label, `describeIndexStats OK — index="${indexName}"`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(step, label, `Check PINECONE_API_KEY and PINECONE_INDEX_NAME. ${msg}`);
    return false;
  }
}

async function testBinance(): Promise<boolean> {
  const step = '4';
  const label = 'Binance Public API — BTCUSDT 24h ticker';
  const url = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      fail(step, label, `HTTP ${res.status}`);
      return false;
    }
    const data = (await res.json()) as { lastPrice?: string };
    const px = parseFloat(data.lastPrice ?? '0');
    pass(step, label, `HTTP ${res.status} — BTC last ≈ $${Number.isFinite(px) ? px.toFixed(2) : '?'}`);
    return true;
  } catch (err) {
    fail(step, label, err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function main() {
  banner('CLEAN BOOT — Sequential connection audit');
  console.log(`  Time : ${new Date().toISOString()}`);
  console.log(`  Node : ${process.version}`);
  console.log(`  CWD  : ${process.cwd()}\n`);

  const results: boolean[] = [];

  // 1 — BullMQ / app Redis (mirrors lib/config getResolvedRedisUrl fallback)
  const redisExplicit = stripEnvQuotes(process.env.REDIS_URL);
  const redisMain = redisExplicit || 'redis://127.0.0.1:6379';
  const r1 = await testRedisPing('1', 'Redis (REDIS_URL) — AUTH + PING', redisMain, false);
  results.push(r1);
  if (r1 && !redisExplicit) {
    console.warn(
      `${COLOR.yellow}WARN${COLOR.reset}  REDIS_URL is unset — test used local fallback redis://127.0.0.1:6379. ` +
      'Set REDIS_URL in production to point at Workspace 2 / German broker.'
    );
  }

  // 1b — Workspace 2 ingestion (optional)
  const whale = stripEnvQuotes(process.env.WHALE_REDIS_URL);
  if (whale) {
    results.push(await testRedisPing('1b', 'Redis (WHALE_REDIS_URL) — Workspace 2 / i9', whale, false));
  } else {
    skip('1b', 'Redis (WHALE_REDIS_URL)', 'Not set — whale subscriber disabled until configured');
    results.push(true);
  }

  results.push(await testPostgres());
  results.push(await testPinecone());
  results.push(await testBinance());

  const allPass = results.every(Boolean);
  console.log('');
  if (allPass) {
    console.log(
      `${COLOR.green}${COLOR.bold}ALL REQUIRED CHECKS PASSED — safe to start trading engine / workers.${COLOR.reset}`
    );
    process.exit(0);
  }
  console.error(
    `${COLOR.red}${COLOR.bold}ONE OR MORE CHECKS FAILED — update the matching keys in .env and re-run.${COLOR.reset}`
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
