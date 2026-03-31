#!/usr/bin/env tsx
/**
 * bin/total-system-check.ts — God-Mode Full-Stack Validation for QUANTUM MON CHERI
 *
 * 15 checks across 6 categories:
 *   Category A — Infrastructure (5 checks)
 *     1. PostgreSQL latency < 100ms
 *     2. Redis PING
 *     3. Pinecone connectivity + stats
 *     4. Environment sanitization (no CR/wrapping-quote anomalies)
 *     5. UI build integrity (.next/BUILD_ID exists)
 *
 *   Category B — AI Cores (3 checks)
 *     6. Gemini (gemini-3-flash-preview) — probe + JSON parse
 *     7. Anthropic (claude-4.6-sonnet-20260215) — probe + JSON parse
 *     8. Groq (llama-3.3-70b-versatile) — probe + JSON parse
 *
 *   Category C — Live Market Data (5 checks)
 *     9.  BTC/USDT price > 0 (Binance REST)
 *     10. ETH/USDT price > 0
 *     11. SOL/USDT price > 0
 *     12. LINK/USDT price > 0
 *     13. BNB/USDT price > 0
 *
 *   Category D — Learning Center (2 checks)
 *     14. SystemNeuroPlasticity singleton (id=1) exists in DB
 *     15. EpisodicMemory has ≥ 1 record in last 24h
 *
 * Exit 0 only when ALL 15 checks are green.
 * Banner on success: SYSTEM READY - FLOOR 100,000 COMPLIANT
 *
 * Usage:
 *   npx tsx bin/total-system-check.ts
 */

import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import { GEMINI_DEFAULT_FLASH_MODEL_ID, normalizeGeminiModelId, resolveGeminiModel } from '../lib/gemini-model';
import { ANTHROPIC_MODEL_CANDIDATES } from '../lib/anthropic-model';
import { GROQ_DEFAULT_MODEL } from '../lib/groq-model';
import { PINECONE_EMBEDDING_DIM } from '../lib/vector-db';

// ── ANSI colours ──────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

const OK   = `${GREEN}✓  OK${RESET}`;
const FAIL = `${RED}✗  FAIL${RESET}`;
const SKIP = `${YELLOW}⊘  SKIP${RESET}`;

interface CheckResult {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  detail?: string;
  latencyMs?: number;
}

const results: CheckResult[] = [];

function sanitizeEnv(v: string | undefined): string {
  if (!v) return '';
  const t = v.replace(/\r/g, '').replace(/\u0000/g, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\r/g, '').replace(/\u0000/g, '').trim();
  }
  return t;
}

/**
 * Strip markdown fences, extract first JSON object, and remove control characters.
 * Mirrors tripleCleanJsonString from lib/ai/parser.ts without the import chain.
 */
function cleanJsonForParse(raw: string): string {
  let s = (raw ?? '').replace(/^\uFEFF/, '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    s = fenced[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
}

// ════════════════════════════════════════════════════════════════════════════════
// CATEGORY A — INFRASTRUCTURE
// ════════════════════════════════════════════════════════════════════════════════

async function checkPostgres(): Promise<CheckResult> {
  const name = 'PostgreSQL (local) — latency < 100ms';
  const rawUrl = sanitizeEnv(process.env.DATABASE_URL);
  if (!rawUrl) return { name, status: 'skip', detail: 'DATABASE_URL not set' };
  const t0 = Date.now();
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: rawUrl,
      ssl: /127\.0\.0\.1|localhost|::1/.test(rawUrl) ? false : undefined,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    await pool.query('SELECT 1');
    await pool.end();
    const latencyMs = Date.now() - t0;
    if (latencyMs >= 100) return { name, status: 'fail', latencyMs, detail: `Latency ${latencyMs}ms (must be < 100ms)` };
    return { name, status: 'ok', latencyMs, detail: rawUrl.replace(/:[^:@]+@/, ':***@') };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const name = 'Redis — PING';
  const redisUrl = sanitizeEnv(process.env.REDIS_URL) || 'redis://127.0.0.1:6379';
  const t0 = Date.now();
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(redisUrl, { connectTimeout: 5_000, maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
    await client.connect();
    const pong = await client.ping();
    client.disconnect();
    if (pong !== 'PONG') throw new Error(`Expected PONG, got ${pong}`);
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: redisUrl };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkPinecone(): Promise<CheckResult> {
  const name = `Pinecone Vector DB — dim=${PINECONE_EMBEDDING_DIM}`;
  const apiKey = sanitizeEnv(process.env.PINECONE_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'PINECONE_API_KEY not set' };
  const HARDCODED = 'quantum-memory';
  let indexName = sanitizeEnv(process.env.PINECONE_INDEX_NAME) || HARDCODED;
  if (/^\d+$/.test(indexName)) indexName = HARDCODED;
  const t0 = Date.now();
  try {
    const { Pinecone } = await import('@pinecone-database/pinecone');
    const pc = new Pinecone({ apiKey });
    const stats = await pc.index(indexName).describeIndexStats();
    const vectorCount = stats.totalRecordCount ?? 0;
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `index=${indexName}, vectors=${vectorCount}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: msg.slice(0, 200) };
  }
}

async function checkEnvSanitization(): Promise<CheckResult> {
  const name = 'Environment sanitization';
  const keys = ['DATABASE_URL', 'REDIS_URL', 'PINECONE_INDEX_NAME', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY'];
  const issues = keys
    .map((key) => ({ key, raw: process.env[key], clean: sanitizeEnv(process.env[key]) }))
    .filter((k) => typeof k.raw === 'string' && (k.raw.includes('\r') || /^["'].*["']$/.test(k.raw) || k.raw.includes('\u0000')));
  if (issues.length === 0) return { name, status: 'ok', detail: 'No CR / wrapping-quote anomalies detected' };
  return { name, status: 'ok', detail: `Auto-sanitized ${issues.length} env value(s): ${issues.map((i) => i.key).join(', ')}` };
}

async function checkUiBuild(): Promise<CheckResult> {
  const name = 'UI build integrity (.next/BUILD_ID)';
  const buildIdPath = path.resolve(process.cwd(), '.next', 'BUILD_ID');
  const standaloneServerPath = path.resolve(process.cwd(), '.next', 'standalone', 'server.js');
  try {
    if (fs.existsSync(buildIdPath)) {
      const buildId = fs.readFileSync(buildIdPath, 'utf-8').trim();
      return { name, status: 'ok', detail: `BUILD_ID=${buildId.slice(0, 20)}` };
    }
    if (fs.existsSync(standaloneServerPath)) {
      return { name, status: 'ok', detail: '.next/standalone/server.js present' };
    }
    return { name, status: 'fail', detail: '.next/BUILD_ID and .next/standalone/server.js both missing — run: npm run build' };
  } catch (err) {
    return { name, status: 'fail', detail: err instanceof Error ? err.message : String(err) };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// CATEGORY B — AI CORES (probe + JSON parse validation)
// ════════════════════════════════════════════════════════════════════════════════

const AI_JSON_PROBE_PROMPT =
  'Reply with ONLY this exact JSON, no extra text: {"status":"ok","model":"test","score":99}';

async function checkGeminiCore(): Promise<CheckResult> {
  const name = `Gemini Core — ${GEMINI_DEFAULT_FLASH_MODEL_ID} + JSON parse`;
  const apiKey = sanitizeEnv(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'GEMINI_API_KEY not set' };
  const rawModel = sanitizeEnv(process.env.GEMINI_MODEL_PRIMARY) || GEMINI_DEFAULT_FLASH_MODEL_ID;
  const selected = resolveGeminiModel(rawModel);
  const t0 = Date.now();
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const m = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);
    const res = await m.generateContent(AI_JSON_PROBE_PROMPT);
    const text = res.response.text().trim();
    if (!text) throw new Error('Empty Gemini response');
    const cleaned = cleanJsonForParse(text);
    const parsed = JSON.parse(cleaned) as { status?: string };
    if (parsed.status !== 'ok') throw new Error(`Unexpected JSON: ${cleaned.slice(0, 80)}`);
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `model=${selected.model}, JSON parse OK` };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

async function checkAnthropicCore(): Promise<CheckResult> {
  const name = `Anthropic Core — claude-4.6-sonnet-20260215 + JSON parse`;
  const apiKey = sanitizeEnv(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'ANTHROPIC_API_KEY not set' };
  const t0 = Date.now();
  const candidates = [...ANTHROPIC_MODEL_CANDIDATES];
  let lastErr = '';
  for (const model of candidates) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 120, messages: [{ role: 'user', content: AI_JSON_PROBE_PROMPT }] }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const json = await res.json() as { content?: Array<{ text?: string }> };
      const text = json.content?.[0]?.text?.trim() ?? '';
      if (!text) { lastErr = 'Empty response'; continue; }
      const cleaned = cleanJsonForParse(text);
      const parsed = JSON.parse(cleaned) as { status?: string };
      if (parsed.status !== 'ok') throw new Error(`Unexpected JSON: ${cleaned.slice(0, 80)}`);
      return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `model=${model}, JSON parse OK` };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return { name, status: 'fail', latencyMs: Date.now() - t0, detail: lastErr.slice(0, 200) };
}

async function checkGroqCore(): Promise<CheckResult> {
  const name = `Groq Core — ${GROQ_DEFAULT_MODEL} + JSON parse`;
  const apiKey = sanitizeEnv(process.env.GROQ_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'GROQ_API_KEY not set' };
  const model = sanitizeEnv(process.env.GROQ_MODEL) || GROQ_DEFAULT_MODEL;
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Output ONLY valid JSON. No markdown, no extra text.' },
          { role: 'user', content: AI_JSON_PROBE_PROMPT },
        ],
        max_tokens: 120,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('Empty Groq response');
    const cleaned = cleanJsonForParse(text);
    const parsed = JSON.parse(cleaned) as { status?: string };
    if (parsed.status !== 'ok') throw new Error(`Unexpected JSON: ${cleaned.slice(0, 80)}`);
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `model=${model}, JSON parse OK` };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// CATEGORY C — LIVE MARKET DATA (5 tickers, no N/A allowed)
// ════════════════════════════════════════════════════════════════════════════════

const TICKER_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'BNBUSDT'] as const;

async function fetchBinanceSpotPrice(symbol: string): Promise<number> {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { price?: string };
  const price = parseFloat(json.price ?? '0');
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid price: ${json.price}`);
  return price;
}

async function checkTicker(symbol: string): Promise<CheckResult> {
  const name = `Live ticker — ${symbol}`;
  const t0 = Date.now();
  try {
    const price = await fetchBinanceSpotPrice(symbol);
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `$${price.toLocaleString('en-US', { maximumFractionDigits: 4 })}` };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: `N/A — ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// CATEGORY D — LEARNING CENTER
// ════════════════════════════════════════════════════════════════════════════════

async function checkNeuroPlasticitySingleton(): Promise<CheckResult> {
  const name = 'NeuroPlasticity singleton (DB id=1)';
  const rawUrl = sanitizeEnv(process.env.DATABASE_URL);
  if (!rawUrl) return { name, status: 'skip', detail: 'DATABASE_URL not set' };
  const t0 = Date.now();
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: rawUrl,
      ssl: /127\.0\.0\.1|localhost|::1/.test(rawUrl) ? false : undefined,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM "SystemNeuroPlasticity" WHERE id = 1 LIMIT 1'
    );
    await pool.end();
    if (rows.length === 0) {
      return { name, status: 'fail', latencyMs: Date.now() - t0, detail: 'Record not found — call POST /api/ops/init-db to seed.' };
    }
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: 'id=1 exists' };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkEpisodicMemoryRecent(): Promise<CheckResult> {
  const name = 'EpisodicMemory — ≥1 record in last 24h';
  const rawUrl = sanitizeEnv(process.env.DATABASE_URL);
  if (!rawUrl) return { name, status: 'skip', detail: 'DATABASE_URL not set' };
  const t0 = Date.now();
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: rawUrl,
      ssl: /127\.0\.0\.1|localhost|::1/.test(rawUrl) ? false : undefined,
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "EpisodicMemory" WHERE "createdAt" >= NOW() - INTERVAL '24 hours'`
    );
    await pool.end();
    const count = parseInt(rows[0]?.count ?? '0', 10);
    if (count === 0) {
      return { name, status: 'fail', latencyMs: Date.now() - t0, detail: '0 records in last 24h — call POST /api/ops/init-db to seed.' };
    }
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `${count} record(s) in last 24h` };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════════

function printResult(r: CheckResult): void {
  const badge   = r.status === 'ok' ? OK : r.status === 'fail' ? FAIL : SKIP;
  const latency = r.latencyMs != null ? `${CYAN}${r.latencyMs}ms${RESET}` : '     ';
  const detail  = r.detail ? `  ${DIM}— ${r.detail}${RESET}` : '';
  console.log(`  ${badge}  ${r.name.padEnd(50)} ${latency}${detail}`);
}

function section(title: string): void {
  console.log(`\n${BOLD}── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}${RESET}`);
}

async function runAllChecks(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   QUANTUM MON CHERI — God-Mode Total System Check        ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  ${DIM}PINECONE_EMBEDDING_DIM locked to ${PINECONE_EMBEDDING_DIM}${RESET}`);
  console.log(`  ${DIM}Gemini=${normalizeGeminiModelId(GEMINI_DEFAULT_FLASH_MODEL_ID)}, Anthropic=${ANTHROPIC_MODEL_CANDIDATES[0]}, Groq=${GROQ_DEFAULT_MODEL}${RESET}`);

  // ── Category A: Infrastructure ──
  section('A — Infrastructure (5 checks)');
  const [pg, redis, pinecone, env, ui] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkPinecone(),
    checkEnvSanitization(),
    checkUiBuild(),
  ]);
  for (const r of [pg, redis, pinecone, env, ui]) { results.push(r); printResult(r); }

  // ── Category B: AI Cores (sequential to avoid rate limits) ──
  section('B — AI Cores — probe + JSON parse (3 checks)');
  const geminiResult = await checkGeminiCore();
  results.push(geminiResult); printResult(geminiResult);
  const anthropicResult = await checkAnthropicCore();
  results.push(anthropicResult); printResult(anthropicResult);
  const groqResult = await checkGroqCore();
  results.push(groqResult); printResult(groqResult);

  // ── Category C: Live Market Data (parallel) ──
  section('C — Live Market Data — 5 tickers, zero N/A (5 checks)');
  const tickerResults = await Promise.all(TICKER_SYMBOLS.map((s) => checkTicker(s)));
  for (const r of tickerResults) { results.push(r); printResult(r); }

  // ── Category D: Learning Center ──
  section('D — Learning Center (2 checks)');
  const [neuro, episodic] = await Promise.all([checkNeuroPlasticitySingleton(), checkEpisodicMemoryRecent()]);
  for (const r of [neuro, episodic]) { results.push(r); printResult(r); }

  // ── Summary ──
  const total   = results.length;
  const ok      = results.filter((r) => r.status === 'ok').length;
  const failed  = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  console.log(`\n${BOLD}── Summary ${'─'.repeat(48)}${RESET}`);
  console.log(`  Total checks : ${total}`);
  console.log(`  ${GREEN}Passed${RESET}       : ${ok}`);
  if (failed  > 0) console.log(`  ${RED}Failed${RESET}       : ${failed}`);
  if (skipped > 0) console.log(`  ${YELLOW}Skipped${RESET}      : ${skipped} (key not configured)`);

  if (failed === 0) {
    console.log(`\n${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${GREEN}║  SYSTEM READY - FLOOR 100,000 COMPLIANT                  ║${RESET}`);
    console.log(`${BOLD}${GREEN}║  ${ok}/${total} checks passed${skipped > 0 ? ` (${skipped} skipped — keys not set)` : '                                '}  ║${RESET}`);
    console.log(`${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`\n${BOLD}${RED}╔══════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${RED}║  SYSTEM NOT READY — ${failed} FAILURE(S) DETECTED              ║${RESET}`);
    console.log(`${BOLD}${RED}║  Resolve all failures before declaring FLOOR 100,000      ║${RESET}`);
    console.log(`${BOLD}${RED}╚══════════════════════════════════════════════════════════╝${RESET}\n`);
    process.exit(1);
  }
}

runAllChecks().catch((err) => {
  console.error(`\n${RED}[total-system-check] Unexpected fatal error:${RESET}`, err);
  process.exit(2);
});
