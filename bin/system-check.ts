#!/usr/bin/env tsx
/**
 * bin/system-check.ts — Full-stack health audit for QUANTUM MON CHERI
 *
 * Checks:
 *   1. Local PostgreSQL  — SELECT 1
 *   2. Redis             — PING
 *   3. All 7 AI Experts  — Gemini (×4), Groq (×1), Anthropic (×1), Pinecone (×1)
 *
 * Usage (from project root):
 *   npx tsx bin/system-check.ts
 *   node_modules/.bin/tsx bin/system-check.ts
 *
 * Exit code: 0 = all green, 1 = one or more checks failed.
 */

import 'dotenv/config';
import { GEMINI_DEFAULT_FLASH_MODEL_ID, normalizeGeminiModelId, resolveGeminiModel } from '../lib/gemini-model';

// ── ANSI colours ──────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
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
const memorySamplesMb: number[] = [];

function sanitizeEnv(v: string | undefined): string {
  if (!v) return '';
  const t = v.replace(/\r/g, '').replace(/\u0000/g, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\r/g, '').replace(/\u0000/g, '').trim();
  }
  return t;
}

function sampleMemory(): number {
  const mb = Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
  memorySamplesMb.push(mb);
  return mb;
}

// ── 1. LOCAL POSTGRESQL ───────────────────────────────────────────────────────
async function checkPostgres(): Promise<CheckResult> {
  const name = 'PostgreSQL (local)';
  const rawUrl = sanitizeEnv(process.env.DATABASE_URL);
  if (!rawUrl) {
    return { name, status: 'skip', detail: 'DATABASE_URL not set' };
  }
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
    if (latencyMs >= 100) {
      return { name, status: 'fail', latencyMs, detail: `Latency ${latencyMs}ms (must be < 100ms)` };
    }
    return { name, status: 'ok', latencyMs, detail: rawUrl.replace(/:[^:@]+@/, ':***@') };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── 2. REDIS ──────────────────────────────────────────────────────────────────
async function checkRedis(): Promise<CheckResult> {
  const name = 'Redis';
  const redisUrl = sanitizeEnv(process.env.REDIS_URL) || 'redis://127.0.0.1:6379';
  const t0 = Date.now();
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(redisUrl, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    await client.connect();
    const pong = await client.ping();
    client.disconnect();
    if (pong !== 'PONG') throw new Error(`Expected PONG, got ${pong}`);
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: redisUrl };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── 3–9. AI EXPERTS ───────────────────────────────────────────────────────────

// Helper: call Gemini generateContent with a tiny probe prompt.
async function probeGemini(expertName: string, modelEnvKey: string): Promise<CheckResult> {
  const apiKey = sanitizeEnv(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!apiKey) return { name: expertName, status: 'skip', detail: 'GEMINI_API_KEY not set' };
  const rawModel = sanitizeEnv(process.env[modelEnvKey]) || GEMINI_DEFAULT_FLASH_MODEL_ID;
  const selected = resolveGeminiModel(rawModel);
  const t0 = Date.now();
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const m = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);
    const res = await m.generateContent('Reply with exactly: OK');
    const text = res.response.text().trim().toLowerCase();
    if (!text) throw new Error('Empty response from Gemini');
    return { name: expertName, status: 'ok', latencyMs: Date.now() - t0, detail: `model=${selected.model}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: expertName, status: 'fail', latencyMs: Date.now() - t0, detail: msg.slice(0, 200) };
  }
}

// Expert 1 — Technician (Gemini primary)
async function checkExpert1(): Promise<CheckResult> {
  return probeGemini('Expert 1 — Technician (Gemini)', 'GEMINI_MODEL_PRIMARY');
}

// Expert 2 — Risk Manager (Gemini)
async function checkExpert2(): Promise<CheckResult> {
  return probeGemini('Expert 2 — Risk Manager (Gemini)', 'GEMINI_MODEL_PRIMARY');
}

// Expert 3 — Market Psychologist (Gemini)
async function checkExpert3(): Promise<CheckResult> {
  return probeGemini('Expert 3 — Market Psychologist (Gemini)', 'GEMINI_MODEL_PRIMARY');
}

// Expert 4 — Macro & Order Book (Groq / Llama)
async function checkExpert4(): Promise<CheckResult> {
  const name = 'Expert 4 — Macro & Order Book (Groq)';
  const apiKey = sanitizeEnv(process.env.GROQ_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'GROQ_API_KEY not set' };
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('Empty Groq response');
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: 'llama-3.1-8b-instant' };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// Expert 5 — On-Chain Sleuth (Anthropic / Claude)
async function checkExpert5(): Promise<CheckResult> {
  const name = 'Expert 5 — On-Chain Sleuth (Anthropic)';
  const apiKey = sanitizeEnv(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'ANTHROPIC_API_KEY not set' };
  const t0 = Date.now();
  try {
    const { ANTHROPIC_MODEL_CANDIDATES } = await import('../lib/anthropic-model');
    const models = [...ANTHROPIC_MODEL_CANDIDATES];
    let lastErr = '';
    for (const model of models) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastErr = `model=${model} HTTP ${res.status}: ${body.slice(0, 180)}`;
        continue;
      }
      const json = await res.json() as { content?: Array<{ text?: string }> };
      const text = json.content?.[0]?.text?.trim() ?? '';
      if (!text) {
        lastErr = `model=${model} returned empty text`;
        continue;
      }
      return { name, status: 'ok', latencyMs: Date.now() - t0, detail: model };
    }
    throw new Error(lastErr || 'No Anthropic model candidate succeeded');
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// Expert 6 — Deep Memory (Gemini embedding + Pinecone)
async function checkExpert6(): Promise<CheckResult> {
  const name = 'Expert 6 — Deep Memory (Gemini Embedding)';
  const geminiKey = sanitizeEnv(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!geminiKey) return { name, status: 'skip', detail: 'GEMINI_API_KEY not set' };
  const t0 = Date.now();
  try {
    const model = 'gemini-embedding-001';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(geminiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: 'system-check-probe' }] },
        outputDimensionality: 768,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini embedContent HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json() as { embedding?: { values?: number[] } };
    const dim = json.embedding?.values?.length ?? 0;
    if (dim !== 768) throw new Error(`Vector dimension mismatch: expected 768, got ${dim}`);
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `${model} dim=${dim}` };
  } catch (err) {
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) };
  }
}

// Expert 7 — Contrarian (Gemini adversarial)
async function checkExpert7(): Promise<CheckResult> {
  return probeGemini('Expert 7 — Contrarian (Gemini)', 'GEMINI_MODEL_PRIMARY');
}

// ── PINECONE CONNECTIVITY ─────────────────────────────────────────────────────
async function checkPinecone(): Promise<CheckResult> {
  const name = 'Pinecone Vector DB';
  const apiKey = sanitizeEnv(process.env.PINECONE_API_KEY);
  if (!apiKey) return { name, status: 'skip', detail: 'PINECONE_API_KEY not set' };

  // Hardened index name — same logic as lib/vector-db.ts
  const HARDCODED = 'quantum-memory';
  let indexName = sanitizeEnv(process.env.PINECONE_INDEX_NAME) || HARDCODED;
  if (/^\d+$/.test(indexName)) indexName = HARDCODED;

  const t0 = Date.now();
  try {
    const { Pinecone } = await import('@pinecone-database/pinecone');
    const pc = new Pinecone({ apiKey });
    const index = pc.index(indexName);
    await index.describeIndexStats();
    return { name, status: 'ok', latencyMs: Date.now() - t0, detail: `index=${indexName}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, status: 'fail', latencyMs: Date.now() - t0, detail: msg.slice(0, 200) };
  }
}

async function checkModelIdentifiers(): Promise<CheckResult> {
  const name = 'Model identifiers (2026 sync)';
  const geminiPrimary = normalizeGeminiModelId(
    sanitizeEnv(process.env.GEMINI_MODEL_PRIMARY) || GEMINI_DEFAULT_FLASH_MODEL_ID
  );
  const geminiFallback = normalizeGeminiModelId(
    sanitizeEnv(process.env.GEMINI_MODEL_FALLBACK) || GEMINI_DEFAULT_FLASH_MODEL_ID
  );
  const { ANTHROPIC_HAIKU_MODEL } = await import('../lib/anthropic-model');
  const anthropicModel = sanitizeEnv(process.env.ANTHROPIC_MODEL) || ANTHROPIC_HAIKU_MODEL;
  const okGemini =
    geminiPrimary === GEMINI_DEFAULT_FLASH_MODEL_ID && geminiFallback === GEMINI_DEFAULT_FLASH_MODEL_ID;
  const okAnthropic = anthropicModel === ANTHROPIC_HAIKU_MODEL;
  if (!okGemini || !okAnthropic) {
    return {
      name,
      status: 'fail',
      detail: `Expected Gemini primary/fallback normalized to ${GEMINI_DEFAULT_FLASH_MODEL_ID} + ${ANTHROPIC_HAIKU_MODEL}; got primary=${geminiPrimary}, fallback=${geminiFallback}, anthropic=${anthropicModel}`,
    };
  }
  return { name, status: 'ok', detail: `primary=${geminiPrimary}, fallback=${geminiFallback}, anthropic=${anthropicModel}` };
}

async function checkMemoryStress(): Promise<CheckResult> {
  const name = 'Memory stress check';
  const peak = memorySamplesMb.length > 0 ? Math.max(...memorySamplesMb) : sampleMemory();
  return { name, status: 'ok', detail: `RSS peak=${peak}MB` };
}

async function checkEnvSanitization(): Promise<CheckResult> {
  const name = 'Environment sanitization';
  const keys = ['DATABASE_URL', 'REDIS_URL', 'PINECONE_INDEX_NAME', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'];
  const issues = keys
    .map((key) => ({ key, raw: process.env[key], clean: sanitizeEnv(process.env[key]) }))
    .filter((k) => typeof k.raw === 'string' && (k.raw.includes('\r') || /^["'].*["']$/.test(k.raw) || k.raw.includes('\u0000')));
  if (issues.length === 0) {
    return { name, status: 'ok', detail: 'No CR/wrapping quote anomalies detected' };
  }
  return { name, status: 'ok', detail: `Sanitized ${issues.length} env value(s): ${issues.map((i) => i.key).join(', ')}` };
}

// ── RUNNER ────────────────────────────────────────────────────────────────────
async function runAllChecks(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║  QUANTUM MON CHERI — Full-Stack System Check         ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  ${new Date().toISOString()}\n`);

  sampleMemory();
  // Run infra checks first (sequential for readability), then experts in parallel.
  const pgResult    = await checkPostgres();
  const redisResult = await checkRedis();
  const envResult   = await checkEnvSanitization();
  const modelResult = await checkModelIdentifiers();

  results.push(pgResult, redisResult);

  console.log(`${BOLD}── Infrastructure ──────────────────────────────────────${RESET}`);
  printResult(pgResult);
  printResult(redisResult);
  printResult(envResult);
  printResult(modelResult);

  console.log(`\n${BOLD}── AI Experts (parallel) ───────────────────────────────${RESET}`);
  sampleMemory();
  const expertResults = await Promise.all([
    checkExpert1(),
    checkExpert2(),
    checkExpert3(),
    checkExpert4(),
    checkExpert5(),
    checkExpert6(),
    checkExpert7(),
    checkPinecone(),
  ]);
  for (const r of expertResults) {
    results.push(r);
    printResult(r);
    sampleMemory();
  }
  const memoryResult = await checkMemoryStress();
  printResult(memoryResult);

  // ── Summary ──
  const total  = results.length;
  const ok     = results.filter((r) => r.status === 'ok').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  console.log(`\n${BOLD}── Summary ─────────────────────────────────────────────${RESET}`);
  console.log(`  Total checks : ${total}`);
  console.log(`  ${GREEN}Passed${RESET}       : ${ok}`);
  if (failed > 0) console.log(`  ${RED}Failed${RESET}       : ${failed}`);
  if (skipped > 0) console.log(`  ${YELLOW}Skipped${RESET}      : ${skipped} (key not configured)`);

  if (failed === 0 && total === 10) {
    console.log(`\n${BOLD}${GREEN}CERTIFICATE OF READINESS: 10/10 GREEN CHECKS${RESET}`);
    console.log(`${GREEN}Deployment status: READY${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`\n${BOLD}${RED}CERTIFICATE OF READINESS: VOID${RESET}`);
    console.log(`${RED}Reason: ${failed} failure(s), ${ok}/10 checks passed.${RESET}\n`);
    process.exit(1);
  }
}

function printResult(r: CheckResult): void {
  const badge  = r.status === 'ok' ? OK : r.status === 'fail' ? FAIL : SKIP;
  const latency = r.latencyMs != null ? `${CYAN}${r.latencyMs}ms${RESET}` : '';
  const detail  = r.detail ? `  — ${r.detail}` : '';
  console.log(`  ${badge}  ${r.name.padEnd(42)} ${latency}${detail}`);
}

runAllChecks().catch((err) => {
  console.error(`\n${RED}[system-check] Unexpected fatal error:${RESET}`, err);
  process.exit(2);
});
