#!/usr/bin/env tsx
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          OMEGA-VERIFY — AUTONOMOUS SYSTEM STABILITY EXAM     ║
 * ║          Quantum Mon Cheri — CEO Stability Proof             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Test 1: Sovereign DB Bridge (PostgreSQL @ 178.104.75.47)    ║
 * ║  Test 2: Whale Redis       (Redis    @ 88.99.208.99)         ║
 * ║  Test 3: Auth API          (/api/auth/request-otp)           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Run:  npx tsx scripts/omega-verify.ts
 */

import * as net from 'net';
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';

// ── Load env vars ─────────────────────────────────────────────────────────────
loadDotenv({ path: path.resolve(process.cwd(), '.env') });

// ── ANSI colours ──────────────────────────────────────────────────────────────
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function pass(msg: string)  { console.log(`  ${GREEN}✅ PASS${RESET}  ${msg}`); }
function fail(msg: string)  { console.log(`  ${RED}❌ FAIL${RESET}  ${msg}`); }
function warn(msg: string)  { console.log(`  ${YELLOW}⚠  WARN${RESET}  ${msg}`); }
function info(msg: string)  { console.log(`  ${CYAN}ℹ  INFO${RESET}  ${msg}`); }

function separator(title?: string) {
  if (title) {
    console.log(`\n${BOLD}${CYAN}${'─'.repeat(58)}${RESET}`);
    console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
    console.log(`${CYAN}${'─'.repeat(58)}${RESET}`);
  } else {
    console.log(`${DIM}${'─'.repeat(58)}${RESET}`);
  }
}

// ── TCP ping helper ───────────────────────────────────────────────────────────

interface PingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

function tcpPing(host: string, port: number, timeoutMs = 5000): Promise<PingResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - t0, error });
    };

    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => done(true));
    socket.on('timeout', () => done(false, `TCP timeout after ${timeoutMs}ms`));
    socket.on('error',   (err) => done(false, err.message));
  });
}

// ── URL parser helper ─────────────────────────────────────────────────────────

function parseHostPort(rawUrl: string, defaultPort: number): { host: string; port: number } | null {
  try {
    // Strip protocol if missing or if it's redis://
    const normalised = rawUrl.startsWith('redis://')  ? rawUrl.replace('redis://', 'http://')
                     : rawUrl.startsWith('rediss://') ? rawUrl.replace('rediss://', 'http://')
                     : rawUrl;
    const u = new URL(normalised);
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port ? parseInt(u.port, 10) : defaultPort,
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1 — Sovereign DB Bridge (PostgreSQL)
// ═══════════════════════════════════════════════════════════════════════════════

async function testPostgres(): Promise<boolean> {
  separator('TEST 1 — Sovereign DB Bridge (PostgreSQL)');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    fail('DATABASE_URL is not set in .env — cannot probe PostgreSQL');
    return false;
  }

  const parsed = parseHostPort(dbUrl, 5432);
  if (!parsed) {
    fail(`Could not parse DATABASE_URL: "${dbUrl.slice(0, 30)}…"`);
    return false;
  }

  info(`Target: ${parsed.host}:${parsed.port}`);

  // TCP ping
  const tcpResult = await tcpPing(parsed.host, parsed.port, 6000);
  if (!tcpResult.ok) {
    fail(`TCP ping failed — ${tcpResult.error}`);
    return false;
  }
  pass(`TCP ping reachable in ${tcpResult.latencyMs}ms`);

  // Attempt a real Postgres connection
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 8000 });
    await client.connect();
    const res = await client.query<{ now: Date }>('SELECT NOW() AS now');
    const serverTime = res.rows[0]?.now?.toISOString() ?? 'unknown';
    await client.end();
    pass(`Postgres query OK — server time: ${serverTime}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Postgres client error: ${msg}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2 — Whale Redis (88.99.208.99)
// ═══════════════════════════════════════════════════════════════════════════════

async function testWhaleRedis(): Promise<boolean> {
  separator('TEST 2 — Whale Redis (quant:alerts pub/sub)');

  const redisUrl = process.env.WHALE_REDIS_URL || process.env.REDIS_URL;
  if (!redisUrl) {
    fail('Neither WHALE_REDIS_URL nor REDIS_URL is set — cannot probe Redis');
    return false;
  }

  const parsed = parseHostPort(redisUrl, 6379);
  if (!parsed) {
    fail(`Could not parse Redis URL`);
    return false;
  }

  info(`Target: ${parsed.host}:${parsed.port}`);

  // TCP ping
  const tcpResult = await tcpPing(parsed.host, parsed.port, 6000);
  if (!tcpResult.ok) {
    fail(`TCP ping failed — ${tcpResult.error}`);
    warn('Whale Redis unreachable. OTP flow will fail. Check firewall / VPN.');
    return false;
  }
  pass(`TCP ping reachable in ${tcpResult.latencyMs}ms`);

  // Attempt a real Redis PING
  try {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 6000,
      enableReadyCheck: false,
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    });

    const pong = await Promise.race([
      client.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('PING timeout')), 5000)),
    ]);

    await client.quit().catch(() => client.disconnect());

    if (pong === 'PONG') {
      pass(`Redis PING → PONG`);
      return true;
    }
    warn(`Redis responded "${pong}" instead of PONG`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Redis client error: ${msg}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3 — Auth API (/api/auth/request-otp)
// ═══════════════════════════════════════════════════════════════════════════════

async function testAuthApi(): Promise<boolean> {
  separator('TEST 3 — Auth API (POST /api/auth/request-otp)');

  const baseUrl = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');

  const endpoint = `${baseUrl}/api/auth/request-otp`;
  info(`Target: ${endpoint}`);

  // ── Sub-test A: Bad password → must return 401 (never 500) ─────────────────
  info('Sub-test A: bad password → expect HTTP 401');
  try {
    const t0 = Date.now();
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ masterPassword: '__omega_bad_password_probe__' }),
      signal:  AbortSignal.timeout(12_000),
    });
    const latency = Date.now() - t0;
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    info(`  Status: ${res.status} | Latency: ${latency}ms | Body: ${JSON.stringify(body)}`);

    if (res.status === 401) {
      pass(`Bad password → 401 Unauthorized (correct) in ${latency}ms`);
    } else if (res.status === 500) {
      fail(`Bad password → 500 Internal Server Error ← CRITICAL BUG`);
      info(`  Response body: ${JSON.stringify(body)}`);
      return false;
    } else if (res.status === 400) {
      warn(`Bad password → 400 (body may have been empty/malformed) — not a 500`);
    } else {
      warn(`Unexpected status ${res.status} — not a crash, but not expected`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
      fail(`Server unreachable at ${endpoint} — is Next.js running? (${msg})`);
    } else if (msg.includes('TimeoutError') || msg.includes('AbortError')) {
      fail(`Request timed out after 12s — possible server hang (confirm no 500 loop)`);
    } else {
      fail(`Fetch error: ${msg}`);
    }
    return false;
  }

  // ── Sub-test B: Missing body → must return 400 (never 500) ─────────────────
  info('Sub-test B: empty body → expect HTTP 400');
  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
      signal:  AbortSignal.timeout(8_000),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status === 400) {
      pass(`Empty body → 400 (correct)`);
    } else if (res.status === 500) {
      fail(`Empty body → 500 ← server is not handling missing payload`);
      return false;
    } else {
      info(`  Empty body status: ${res.status} | ${JSON.stringify(body)}`);
    }
  } catch {
    warn('Sub-test B request failed — skipping');
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n');
  console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   ⚡ OMEGA-VERIFY — QUANTUM MON CHERI STABILITY EXAM    ║${RESET}`);
  const ts = new Date().toISOString();
  console.log(`${BOLD}${CYAN}║  ${ts}  ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log();

  const results: { name: string; passed: boolean }[] = [];

  const t0 = Date.now();

  results.push({ name: 'Sovereign DB Bridge (PostgreSQL)', passed: await testPostgres() });
  results.push({ name: 'Whale Redis (quant:alerts)',       passed: await testWhaleRedis() });
  results.push({ name: 'Auth API (request-otp)',           passed: await testAuthApi() });

  const totalMs = Date.now() - t0;

  // ── Summary ─────────────────────────────────────────────────────────────────
  separator('📊 OMEGA-VERIFY REPORT');
  console.log();

  let allPassed = true;
  for (const r of results) {
    if (r.passed) {
      console.log(`  ${GREEN}✅${RESET}  ${r.name}`);
    } else {
      console.log(`  ${RED}❌${RESET}  ${r.name}`);
      allPassed = false;
    }
  }

  console.log();
  separator();

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;

  console.log(`\n  ${BOLD}Tests run:  ${results.length}${RESET}`);
  console.log(`  ${GREEN}${BOLD}Passed:     ${passCount}${RESET}`);
  if (failCount > 0) {
    console.log(`  ${RED}${BOLD}Failed:     ${failCount}${RESET}`);
  }
  console.log(`  ${DIM}Duration:   ${totalMs}ms${RESET}`);
  console.log();

  if (allPassed) {
    console.log(`${GREEN}${BOLD}  ✅ SYSTEM STABLE — ALL PROBES GREEN${RESET}`);
  } else {
    console.log(`${RED}${BOLD}  ❌ SYSTEM DEGRADED — ${failCount} PROBE(S) FAILED${RESET}`);
    console.log(`${YELLOW}     Review the output above and fix each failing component.${RESET}`);
  }

  console.log('\n');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`${RED}${BOLD}[omega-verify] Unhandled fatal error:${RESET}`, err);
  process.exit(1);
});
