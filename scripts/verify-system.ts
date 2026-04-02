#!/usr/bin/env tsx
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║            QUANTUM SYSTEM VERIFICATION SCRIPT                        ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║  Run: npm run verify                                                  ║
 * ║                                                                       ║
 * ║  Checks:                                                              ║
 * ║   A. Ping Sovereign DB (178.104.75.47)  → Assert connection          ║
 * ║   B. All expected tables exist in information_schema                  ║
 * ║   C. Ping Whale Redis (88.99.208.99)    → Assert connection          ║
 * ║   D. Orchestrator Queue defined in Redis                              ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import Redis from 'ioredis';

// Load .env from workspace root
config();

// ── ANSI colour helpers ──────────────────────────────────────────────────────
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW= '\x1b[33m';
const CYAN  = '\x1b[36m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

function ok(msg: string)   { console.log(`${GREEN}  ✔  ${msg}${RESET}`); }
function fail(msg: string) { console.error(`${RED}${BOLD}  ✘  ${msg}${RESET}`); }
function info(msg: string) { console.log(`${CYAN}  ·  ${msg}${RESET}`); }
function warn(msg: string) { console.log(`${YELLOW}  ⚠  ${msg}${RESET}`); }
function header(msg: string) {
  console.log(`\n${BOLD}${CYAN}═══ ${msg} ${'═'.repeat(Math.max(0, 56 - msg.length))}${RESET}`);
}

// ── Expected tables ──────────────────────────────────────────────────────────
const EXPECTED_TABLES = [
  'prediction_records',
  'settings',
  'telegram_subscribers',
  'system_settings',
  'expert_weights',
  'prediction_weights',
  'system_configs',
  'weight_change_log',
  'accuracy_snapshots',
  'virtual_portfolio',
  'execution_pipeline_claims',
  'virtual_trades_history',
  'scanner_alert_log',
  'agent_insights',
  'board_meeting_logs',
  'simulation_trades',
  'historical_predictions',
  'ai_learning_ledger',
  'backtest_logs',
  'deep_analysis_logs',
  'portfolio_history',
  'audit_logs',
  'learning_reports',
  'daily_accuracy_stats',
  'trade_executions',
  'learned_insights',
  'failed_signals',
];

// ── Main verification flow ───────────────────────────────────────────────────
async function verify(): Promise<void> {
  let passed = 0;
  let failed = 0;

  console.log(`\n${BOLD}${CYAN}╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║       QUANTUM SYSTEM VERIFICATION STARTING        ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════════════════╝${RESET}`);

  // ── STEP A: Sovereign DB connection ─────────────────────────────────────────
  header('STEP A: Sovereign DB Connection');

  const dbUrl = (process.env.DATABASE_URL ?? '').trim().replace(/^["']|["']$/g, '');
  if (!dbUrl) {
    fail('DATABASE_URL is not set');
    process.exit(1);
  }

  let dbHostLabel = 'unknown';
  try {
    const parsed = new URL(dbUrl);
    dbHostLabel = `${parsed.hostname}:${parsed.port || '5432'}`;
  } catch { /* keep default */ }

  info(`Connecting to ${dbHostLabel}...`);

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 15_000,
  });

  try {
    const res = await pool.query('SELECT NOW() AS ts, version() AS ver');
    const ts  = (res.rows[0] as { ts: Date; ver: string }).ts;
    const ver = (res.rows[0] as { ts: Date; ver: string }).ver.split(' ').slice(0, 2).join(' ');
    ok(`DB connected — server time ${ts.toISOString()} | ${ver}`);
    passed++;
  } catch (err) {
    fail(`DB connection FAILED: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
    await pool.end().catch(() => null);
    // Continue to show table status even if connection failed on ping
  }

  // ── STEP B: Table existence check ───────────────────────────────────────────
  header('STEP B: Table Schema Verification');

  let missingTables: string[] = [];
  try {
    const dbName = (() => {
      try { return new URL(dbUrl).pathname.replace(/^\//, '') || 'postgres'; }
      catch { return 'postgres'; }
    })();

    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_catalog = $1
         AND table_type = 'BASE TABLE'`,
      [dbName]
    );

    const existing = new Set(result.rows.map((r) => r.table_name));
    missingTables = EXPECTED_TABLES.filter((t) => !existing.has(t));

    if (missingTables.length === 0) {
      ok(`All ${EXPECTED_TABLES.length} expected tables exist`);
      passed++;
    } else {
      fail(`${missingTables.length} table(s) MISSING: ${missingTables.join(', ')}`);
      failed++;
    }

    // Show found table count as info
    info(`Tables found in DB: ${existing.size} (expected ${EXPECTED_TABLES.length})`);
  } catch (err) {
    fail(`Table check FAILED: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  await pool.end().catch(() => null);

  // ── STEP C: Whale Redis connection ──────────────────────────────────────────
  header('STEP C: Whale Redis Connection');

  const whaleRedisUrl = (process.env.WHALE_REDIS_URL ?? '').trim().replace(/^["']|["']$/g, '');
  if (!whaleRedisUrl) {
    warn('WHALE_REDIS_URL not set — skipping Whale Redis check');
  } else {
    let whaleRedisHostLabel = 'unknown';
    try {
      const parsed = new URL(whaleRedisUrl);
      whaleRedisHostLabel = `${parsed.hostname}:${parsed.port || '6379'}`;
    } catch { /* keep default */ }

    info(`Connecting to Whale Redis at ${whaleRedisHostLabel}...`);

    const whaleRedis = new Redis(whaleRedisUrl, {
      connectTimeout: 8_000,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });

    try {
      await whaleRedis.connect();
      const pong = await whaleRedis.ping();
      if (pong === 'PONG') {
        ok(`Whale Redis ONLINE — ${whaleRedisHostLabel}`);
        passed++;
      } else {
        fail(`Whale Redis ping returned unexpected: ${pong}`);
        failed++;
      }
    } catch (err) {
      fail(`Whale Redis FAILED: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    } finally {
      await whaleRedis.quit().catch(() => null);
    }
  }

  // ── STEP D: Orchestrator Queue in Redis ──────────────────────────────────────
  header('STEP D: Orchestrator Queue (BullMQ)');

  const localRedisUrl = (process.env.REDIS_URL ?? 'redis://127.0.0.1:6379').trim().replace(/^["']|["']$/g, '');
  info(`Checking BullMQ queue on ${localRedisUrl}...`);

  const localRedis = new Redis(localRedisUrl, {
    connectTimeout: 5_000,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
  });

  try {
    await localRedis.connect();
    // BullMQ stores queue metadata as keys like bull:<queueName>:meta
    const keys = await localRedis.keys('bull:*');
    const queueNames = [...new Set(keys.map((k) => k.split(':')[1]).filter(Boolean))];

    if (queueNames.length > 0) {
      ok(`BullMQ queue(s) found: ${queueNames.join(', ')}`);
      passed++;
    } else {
      warn('No BullMQ queues found in Redis yet (queue initializes on first job)');
      passed++; // Not a fatal failure — queues are lazy-created
    }

    const pingLocal = await localRedis.ping();
    if (pingLocal !== 'PONG') {
      fail(`Local Redis ping unexpected: ${pingLocal}`);
      failed++;
    }
  } catch (err) {
    fail(`Local Redis FAILED: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  } finally {
    await localRedis.quit().catch(() => null);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${'═'.repeat(60)}${RESET}`);
  if (failed === 0) {
    console.log(`\n${GREEN}${BOLD}  ✅  QUANTUM SYSTEM VERIFIED — ${passed} checks passed${RESET}\n`);
    process.exit(0);
  } else {
    console.error(`\n${RED}${BOLD}  ❌  VERIFICATION FAILED — ${failed} check(s) failed, ${passed} passed${RESET}`);
    if (missingTables.length > 0) {
      console.error(`${RED}      Missing tables: ${missingTables.join(', ')}${RESET}`);
      console.error(`${YELLOW}      Run the server once (npm run start) to trigger db-bootstrapper.ts${RESET}`);
    }
    console.log('');
    process.exit(1);
  }
}

verify().catch((err) => {
  console.error(`${RED}${BOLD}[verify-system] FATAL: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  process.exit(1);
});
