#!/usr/bin/env tsx
/**
 * bin/absolute-truth-scanner.ts — ABSOLUTE TRUTH SCANNER
 * Zero-Trust active validation of every critical system junction.
 * NO MOCKS. NO ASSUMPTIONS. RAW RESULTS ONLY.
 *
 * Usage: npx tsx bin/absolute-truth-scanner.ts
 */

import 'dotenv/config';

// ─── ANSI ────────────────────────────────────────────────────────────────────
const R  = '\x1b[0m';
const G  = '\x1b[32m';
const RD = '\x1b[31m';
const Y  = '\x1b[33m';
const C  = '\x1b[36m';
const B  = '\x1b[1m';
const M  = '\x1b[35m';

const PASS  = `${G}${B}[PASS]${R}`;
const FATAL = `${RD}${B}[FATAL]${R}`;
const INFO  = `${C}[INFO] ${R}`;

let fatalOccurred = false;

function log(msg: string) { console.log(msg); }
function fatal(section: string, detail: string): never {
  console.error(`\n${FATAL} ══ HARD STOP: ${B}${section}${R}`);
  console.error(`${RD}  └─ ${detail}${R}`);
  fatalOccurred = true;
  process.exit(1);
}

function sanitize(v: string | undefined): string {
  if (!v) return '';
  const t = v.replace(/\r/g, '').replace(/\u0000/g, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1).trim();
  return t;
}

/** Inline tripleCleanJsonString — mirrors lib/ai/parser.ts without import chain */
function tripleCleanJsonString(raw: string): string {
  let s = String(raw ?? '').replace(/^\uFEFF/, '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    s = fenced[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — INFRASTRUCTURE PING
// ─────────────────────────────────────────────────────────────────────────────

async function scanPostgres() {
  log(`\n${B}${M}━━━ [1/7] POSTGRES ━━━${R}`);
  const url = sanitize(process.env.DATABASE_URL);
  if (!url) fatal('Postgres', 'DATABASE_URL is not set');

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /127\.0\.0\.1|localhost|::1/.test(url) ? false : undefined,
    max: 1,
    connectionTimeoutMillis: 8_000,
  });

  const t0 = Date.now();
  let rows: unknown;
  try {
    const res = await pool.query('SELECT 1 AS probe');
    rows = res.rows;
  } catch (err) {
    await pool.end().catch(() => {});
    fatal('Postgres SELECT 1', err instanceof Error ? err.message : String(err));
  }
  const selectLatency = Date.now() - t0;
  log(`${PASS} SELECT 1 → rows=${JSON.stringify(rows)}  latency=${selectLatency}ms`);

  // Count rows in a main table
  let tableCount = 0;
  try {
    const c = await pool.query(`SELECT COUNT(*) AS n FROM "AlphaSignalRecord"`);
    tableCount = Number(c.rows[0]?.n ?? 0);
  } catch {
    try {
      const c = await pool.query(`SELECT COUNT(*) AS n FROM "TradeExecution"`);
      tableCount = Number(c.rows[0]?.n ?? 0);
      log(`${INFO} AlphaSignalRecord not found; counted TradeExecution: ${tableCount} rows`);
    } catch (err2) {
      log(`${Y}[WARN] Could not count rows: ${err2 instanceof Error ? err2.message : String(err2)}${R}`);
    }
  }
  if (tableCount > 0) log(`${PASS} AlphaSignalRecord row count = ${B}${tableCount}${R}`);

  await pool.end().catch(() => {});
  log(`${INFO} Total Postgres latency: ${B}${selectLatency}ms${R}`);
}

async function scanRedis() {
  log(`\n${B}${M}━━━ [2/7] REDIS ━━━${R}`);
  const redisUrl = sanitize(process.env.REDIS_URL) || 'redis://127.0.0.1:6379';

  const { default: Redis } = await import('ioredis');
  const client = new Redis(redisUrl, {
    connectTimeout: 8_000,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    enableOfflineQueue: false,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

  const t0 = Date.now();
  try {
    await client.connect();
  } catch (err) {
    client.disconnect();
    fatal('Redis connect', `${redisUrl} — ${err instanceof Error ? err.message : String(err)}`);
  }

  const pong = await client.ping();
  const pingLatency = Date.now() - t0;
  if (pong !== 'PONG') fatal('Redis PING', `Expected PONG, got: ${pong}`);
  log(`${PASS} PING → ${B}${pong}${R}  latency=${pingLatency}ms`);

  // Check queue-worker:heartbeat key
  const heartbeatKey = 'queue-worker:heartbeat';
  const heartbeatVal = await client.get(heartbeatKey);
  const heartbeatTTL = await client.ttl(heartbeatKey);

  if (heartbeatVal === null) {
    log(`${Y}[WARN] ${heartbeatKey} = NULL (worker may be offline or heartbeat not yet written)${R}`);
  } else {
    log(`${PASS} ${heartbeatKey} = ${B}${heartbeatVal}${R}  TTL=${B}${heartbeatTTL}s${R}`);
  }
  log(`${INFO} queue-worker:heartbeat raw TTL: ${B}${heartbeatTTL}${R}`);

  client.disconnect();
}

async function scanPinecone() {
  log(`\n${B}${M}━━━ [3/7] PINECONE ━━━${R}`);
  const apiKey = sanitize(process.env.PINECONE_API_KEY);
  if (!apiKey) fatal('Pinecone', 'PINECONE_API_KEY is not set');

  const HARDCODED = 'quantum-memory';
  let indexName = sanitize(process.env.PINECONE_INDEX_NAME) || HARDCODED;
  if (/^\d+$/.test(indexName)) indexName = HARDCODED;

  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey });

  const t0 = Date.now();

  // describeIndex gives us dimension
  let indexDesc: { dimension?: number; name?: string; status?: unknown; spec?: unknown };
  try {
    indexDesc = await pc.describeIndex(indexName) as typeof indexDesc;
  } catch (err) {
    fatal('Pinecone describeIndex', `index="${indexName}" — ${err instanceof Error ? err.message : String(err)}`);
  }
  const descLatency = Date.now() - t0;
  const dim = indexDesc!.dimension;
  log(`${INFO} describeIndex response: ${JSON.stringify({ name: indexDesc!.name, dimension: dim, status: indexDesc!.status })}`);

  if (dim !== 768) {
    fatal('Pinecone dimension assertion', `Expected dimension=768, got dimension=${dim}`);
  }
  log(`${PASS} dimension = ${B}${dim}${R} (EXACT MATCH: 768)  latency=${descLatency}ms`);

  // Also fetch stats
  const stats = await pc.index(indexName).describeIndexStats();
  const totalVectors = stats.totalRecordCount ?? 0;
  log(`${PASS} index="${indexName}"  totalVectors=${B}${totalVectors}${R}`);
  log(`${INFO} Namespace breakdown: ${JSON.stringify(stats.namespaces ?? {})}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — LIVE MARKET DATA
// ─────────────────────────────────────────────────────────────────────────────

async function scanMarketData() {
  log(`\n${B}${M}━━━ [4/7] LIVE MARKET DATA ━━━${R}`);

  // BTC/USDT price from Binance
  const priceUrl = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
  const t0 = Date.now();
  let btcPrice = 0;
  try {
    const res = await fetch(priceUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) fatal('Binance BTC price', `HTTP ${res.status} from ${priceUrl}`);
    const data = await res.json() as { symbol?: string; price?: string };
    btcPrice = parseFloat(data.price ?? '0');
    if (!btcPrice || btcPrice <= 0) fatal('Binance BTC price', `Invalid price: ${JSON.stringify(data)}`);
    log(`${PASS} Binance BTCUSDT price = ${B}$${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${R}  latency=${Date.now() - t0}ms`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('HTTP')) throw err;
    fatal('Binance BTCUSDT', err instanceof Error ? err.message : String(err));
  }

  // Whale detection: pull last 50 agg trades, find the largest by quoteQty
  const whaleUrl = 'https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&limit=50';
  const tw = Date.now();
  try {
    const res = await fetch(whaleUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) fatal('Binance aggTrades', `HTTP ${res.status}`);
    type AggTrade = { p: string; q: string; T: number; m: boolean };
    const trades = await res.json() as AggTrade[];
    if (!Array.isArray(trades) || trades.length === 0)
      fatal('Binance aggTrades', 'Empty trade array returned');

    const enriched = trades.map(t => ({
      price: parseFloat(t.p),
      qty: parseFloat(t.q),
      quoteQty: parseFloat(t.p) * parseFloat(t.q),
      time: new Date(t.T).toISOString(),
      side: t.m ? 'SELL' : 'BUY',
    }));

    const largest = enriched.reduce((a, b) => a.quoteQty > b.quoteQty ? a : b);
    log(`${PASS} Last whale (largest of 50 aggTrades):  side=${B}${largest.side}${R}  qty=${largest.qty.toFixed(4)} BTC  value=${B}$${largest.quoteQty.toLocaleString('en-US', { maximumFractionDigits: 0 })}${R}  at ${largest.time}  latency=${Date.now() - tw}ms`);

    const total24h = enriched.reduce((s, t) => s + t.quoteQty, 0);
    log(`${INFO} Cumulative volume of last 50 trades: $${total24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('HTTP')) {
      log(`${Y}[WARN] aggTrades failed: ${err.message}${R}`);
    } else throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — TRI-CORE AI VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

const AI_PROBE = "Respond with a raw JSON object containing {\"status\": \"active\"}. No markdown. No extra text. Only the JSON object.";

async function scanGroq() {
  log(`\n${B}${M}━━━ [5/7] GROQ — llama-3.3-70b-versatile ━━━${R}`);
  const apiKey = sanitize(process.env.GROQ_API_KEY);
  if (!apiKey) fatal('Groq', 'GROQ_API_KEY is not set');

  const model = sanitize(process.env.GROQ_MODEL) || 'llama-3.3-70b-versatile';
  log(`${INFO} Sending probe to model=${model} ...`);

  const t0 = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Output ONLY valid JSON. No markdown, no extra text.' },
        { role: 'user', content: AI_PROBE },
      ],
      max_tokens: 60,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(err => fatal('Groq fetch', err instanceof Error ? err.message : String(err)));

  if (!res.ok) {
    const body = await res.text();
    fatal('Groq API', `HTTP ${res.status} — ${body.slice(0, 300)}`);
  }

  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
  const raw = json.choices?.[0]?.message?.content ?? '';
  const latency = Date.now() - t0;

  log(`${INFO} Raw Groq response: ${B}${raw}${R}`);
  log(`${INFO} Usage: ${JSON.stringify(json.usage ?? {})}`);

  const cleaned = tripleCleanJsonString(raw);
  log(`${INFO} After tripleCleanJsonString: ${cleaned}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    fatal('Groq JSON parse', `tripleCleanJsonString output is not valid JSON.\n  Cleaned: "${cleaned}"\n  Error: ${e instanceof Error ? e.message : String(e)}`);
  }

  log(`${PASS} Groq parsed output: ${B}${JSON.stringify(parsed)}${R}  latency=${latency}ms`);
  const status = (parsed as { status?: string })?.status;
  if (!status) log(`${Y}[WARN] 'status' field missing from Groq response — got: ${JSON.stringify(parsed)}${R}`);
  else log(`${PASS} status field = "${B}${status}${R}"`);
}

async function scanGemini() {
  log(`\n${B}${M}━━━ [6/7] GEMINI — gemini-3-flash-preview ━━━${R}`);
  const apiKey = sanitize(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!apiKey) fatal('Gemini', 'GEMINI_API_KEY (or GOOGLE_API_KEY) is not set');

  // Model resolution mirrors lib/gemini-model.ts retirement map
  const RETIRED: Record<string, string> = {
    'gemini-1.5-flash': 'gemini-3-flash-preview',
    'gemini-1.5-pro': 'gemini-3-flash-preview',
    'gemini-2.0-flash': 'gemini-3-flash-preview',
    'gemini-2.5-flash': 'gemini-3-flash-preview',
  };
  const rawModel = sanitize(process.env.GEMINI_MODEL_PRIMARY) || 'gemini-3-flash-preview';
  const model = RETIRED[rawModel] ?? rawModel;
  log(`${INFO} Resolved model: ${model} (from env: ${rawModel})`);

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });

  const t0 = Date.now();
  let raw = '';
  try {
    const result = await m.generateContent(AI_PROBE);
    raw = result.response.text().trim();
  } catch (err) {
    fatal('Gemini generateContent', err instanceof Error ? err.message : String(err));
  }
  const latency = Date.now() - t0;

  log(`${INFO} Raw Gemini response: ${B}${raw}${R}`);

  const cleaned = tripleCleanJsonString(raw);
  log(`${INFO} After tripleCleanJsonString: ${cleaned}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    fatal('Gemini JSON parse', `tripleCleanJsonString output is not valid JSON.\n  Cleaned: "${cleaned}"\n  Error: ${e instanceof Error ? e.message : String(e)}`);
  }

  log(`${PASS} Gemini parsed output: ${B}${JSON.stringify(parsed)}${R}  latency=${latency}ms`);
  const status = (parsed as { status?: string })?.status;
  if (!status) log(`${Y}[WARN] 'status' field missing — got: ${JSON.stringify(parsed)}${R}`);
  else log(`${PASS} status field = "${B}${status}${R}"`);
}

async function scanAnthropic() {
  log(`\n${B}${M}━━━ [7a/7] ANTHROPIC — claude-4.6-sonnet-20260215 ━━━${R}`);
  const apiKey = sanitize(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (!apiKey) fatal('Anthropic', 'ANTHROPIC_API_KEY is not set');

  const candidates = ['claude-4.6-sonnet-20260215', 'claude-4-sonnet-20250514', 'claude-haiku-4-5-20251001'];
  let lastErr = '';

  for (const model of candidates) {
    log(`${INFO} Trying model=${model} ...`);
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 80,
          messages: [{ role: 'user', content: AI_PROBE }],
        }),
        signal: AbortSignal.timeout(25_000),
      });

      if (!res.ok) {
        const body = await res.text();
        lastErr = `HTTP ${res.status} — ${body.slice(0, 200)}`;
        log(`${Y}[WARN] ${model}: ${lastErr}${R}`);
        continue;
      }

      const json = await res.json() as { content?: Array<{ type?: string; text?: string }>; usage?: unknown };
      const raw = json.content?.[0]?.text?.trim() ?? '';
      const latency = Date.now() - t0;

      log(`${INFO} Raw Anthropic response: ${B}${raw}${R}`);
      log(`${INFO} Usage: ${JSON.stringify(json.usage ?? {})}`);

      const cleaned = tripleCleanJsonString(raw);
      log(`${INFO} After tripleCleanJsonString: ${cleaned}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        fatal('Anthropic JSON parse', `model=${model} — tripleCleanJsonString output is not valid JSON.\n  Cleaned: "${cleaned}"\n  Error: ${e instanceof Error ? e.message : String(e)}`);
      }

      log(`${PASS} Anthropic parsed output: ${B}${JSON.stringify(parsed)}${R}  model=${model}  latency=${latency}ms`);
      const status = (parsed as { status?: string })?.status;
      if (!status) log(`${Y}[WARN] 'status' field missing — got: ${JSON.stringify(parsed)}${R}`);
      else log(`${PASS} status field = "${B}${status}${R}"`);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      log(`${Y}[WARN] ${model} threw: ${lastErr}${R}`);
    }
  }
  fatal('Anthropic', `All candidate models failed. Last error: ${lastErr}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — NEUROPLASTICITY & MEMORY
// ─────────────────────────────────────────────────────────────────────────────

async function scanNeuroplasticityAndMemory() {
  log(`\n${B}${M}━━━ [7b/7] NEUROPLASTICITY & EPISODIC MEMORY ━━━${R}`);
  const url = sanitize(process.env.DATABASE_URL);
  if (!url) fatal('Neuroplasticity', 'DATABASE_URL is not set — cannot query DB');

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /127\.0\.0\.1|localhost|::1/.test(url) ? false : undefined,
    max: 1,
    connectionTimeoutMillis: 8_000,
  });

  // Query SystemNeuroPlasticity (singleton id=1)
  try {
    const res = await pool.query<{
      id: number;
      techWeight: number; riskWeight: number; psychWeight: number;
      macroWeight: number; onchainWeight: number; deepMemoryWeight: number;
      contrarianWeight: number; ceoConfidenceThreshold: number; updatedAt: Date;
    }>(`SELECT id, "techWeight", "riskWeight", "psychWeight", "macroWeight",
              "onchainWeight", "deepMemoryWeight", "contrarianWeight",
              "ceoConfidenceThreshold", "updatedAt"
       FROM "SystemNeuroPlasticity" WHERE id = 1 LIMIT 1`);

    if (res.rows.length === 0) {
      log(`${Y}[WARN] SystemNeuroPlasticity row id=1 does NOT exist — system has never run RL optimizer${R}`);
    } else {
      const r = res.rows[0];
      log(`${PASS} SystemNeuroPlasticity (id=1) EXISTS  updatedAt=${r.updatedAt?.toISOString()}`);
      log(`\n  ${B}7 Expert Weights:${R}`);
      log(`    techWeight       = ${B}${r.techWeight}${R}`);
      log(`    riskWeight       = ${B}${r.riskWeight}${R}`);
      log(`    psychWeight      = ${B}${r.psychWeight}${R}`);
      log(`    macroWeight      = ${B}${r.macroWeight}${R}`);
      log(`    onchainWeight    = ${B}${r.onchainWeight}${R}`);
      log(`    deepMemoryWeight = ${B}${r.deepMemoryWeight}${R}`);
      log(`    contrarianWeight = ${B}${r.contrarianWeight}${R}`);
      log(`    ceoConfidenceThreshold = ${B}${r.ceoConfidenceThreshold}${R}`);

      // Sanity: detect stuck weights
      const weights = [r.techWeight, r.riskWeight, r.psychWeight, r.macroWeight, r.onchainWeight, r.deepMemoryWeight, r.contrarianWeight];
      const allDefault = weights.every(w => w === 1.0);
      const someMax = weights.some(w => w >= 2.9);
      const someMin = weights.some(w => w <= 0.11);
      if (allDefault) log(`${Y}  [WARN] All 7 weights = 1.0 → RL optimizer has never adjusted them${R}`);
      if (someMax) log(`${Y}  [WARN] At least one weight is at max clamp (≥2.9) — check RL stability${R}`);
      if (someMin) log(`${Y}  [WARN] At least one weight is at min clamp (≤0.11) — expert may be suppressed${R}`);
    }
  } catch (err) {
    log(`${RD}[ERR] SystemNeuroPlasticity query failed: ${err instanceof Error ? err.message : String(err)}${R}`);
  }

  // Query EpisodicMemory count
  try {
    const res = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "EpisodicMemory"`);
    const count = parseInt(res.rows[0]?.n ?? '0', 10);
    if (count === 0) {
      log(`\n${Y}[WARN] EpisodicMemory = 0 rows — system has never completed a post-mortem RL cycle${R}`);
    } else {
      log(`\n${PASS} EpisodicMemory total rows = ${B}${count}${R}`);
    }

    // Recent rows (last 24h)
    const recent = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "EpisodicMemory" WHERE "createdAt" > NOW() - INTERVAL '24 hours'`);
    const recentCount = parseInt(recent.rows[0]?.n ?? '0', 10);
    log(`${INFO} EpisodicMemory rows in last 24h: ${B}${recentCount}${R}`);

    // Print last 3 lessons
    if (count > 0) {
      const last3 = await pool.query<{ id: string; symbol: string; abstractLesson: string; createdAt: Date }>(
        `SELECT id, symbol, "abstractLesson", "createdAt" FROM "EpisodicMemory" ORDER BY "createdAt" DESC LIMIT 3`
      );
      log(`\n  ${B}Last 3 episodic memories:${R}`);
      for (const row of last3.rows) {
        log(`    [${row.createdAt?.toISOString()}] ${row.symbol} — ${row.abstractLesson.slice(0, 120)}`);
      }
    }
  } catch (err) {
    log(`${RD}[ERR] EpisodicMemory query failed: ${err instanceof Error ? err.message : String(err)}${R}`);
  }

  await pool.end().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════════════╗${R}`);
  console.log(`${B}${C}║       ABSOLUTE TRUTH SCANNER — ZERO-TRUST VALIDATION         ║${R}`);
  console.log(`${B}${C}║       ${new Date().toISOString()}                   ║${R}`);
  console.log(`${B}${C}╚══════════════════════════════════════════════════════════════╝${R}`);

  const start = Date.now();

  await scanPostgres();
  await scanRedis();
  await scanPinecone();
  await scanMarketData();
  await scanGroq();
  await scanGemini();
  await scanAnthropic();
  await scanNeuroplasticityAndMemory();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${B}${G}╔══════════════════════════════════════════════════════════════╗${R}`);
  console.log(`${B}${G}║  ALL SECTIONS COMPLETED — TRUTH DELIVERED — ${elapsed}s total   ${R}`);
  console.log(`${B}${G}╚══════════════════════════════════════════════════════════════╝${R}\n`);
  process.exit(0);
}

main().catch(err => {
  if (!fatalOccurred) {
    console.error(`\n${FATAL} Unhandled top-level error:`);
    console.error(err);
    process.exit(1);
  }
});
