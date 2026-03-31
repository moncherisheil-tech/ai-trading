#!/usr/bin/env tsx
/**
 * bin/local-scan.ts — Runs all checks that CAN execute locally:
 *   - Binance BTC price + whale detection
 *   - Groq llama-3.3-70b-versatile JSON probe
 *   - Gemini gemini-3-flash-preview JSON probe
 *   - Anthropic claude-3-5-sonnet-latest JSON probe
 *   - Pinecone index stats + dimension assertion (768)
 */
import 'dotenv/config';

const R='\x1b[0m', G='\x1b[32m', RD='\x1b[31m', C='\x1b[36m', B='\x1b[1m', M='\x1b[35m', Y='\x1b[33m';
const PASS=`${G}${B}[PASS]${R}`, FAIL=`${RD}${B}[FATAL]${R}`, INFO=`${C}[INFO] ${R}`;

function sanitize(v: string | undefined): string {
  if (!v) return '';
  const t = v.replace(/\r/g, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).trim();
  return t;
}

function clean(raw: string): string {
  let s = String(raw ?? '').replace(/^\uFEFF/, '');
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (f?.[1]) { s = f[1].trim(); } else { s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim(); }
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const fi = s.indexOf('{'); const la = s.lastIndexOf('}');
  if (fi >= 0 && la > fi) s = s.slice(fi, la + 1);
  return s.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
}

const PROBE = 'Respond with a raw JSON object containing {"status": "active"}. No markdown. Only the JSON.';

async function main() {
  console.log(`\n${B}${C}╔═══════════════════════════════════════════════════════════╗${R}`);
  console.log(`${B}${C}║  ABSOLUTE TRUTH — LOCAL SCAN (AI + MARKET + VECTOR DB)   ║${R}`);
  console.log(`${B}${C}║  ${new Date().toISOString()}                              ║${R}`);
  console.log(`${B}${C}╚═══════════════════════════════════════════════════════════╝${R}`);

  // ── [A] BINANCE ──────────────────────────────────────────────────────────────
  console.log(`\n${B}${M}━━━ [A] BINANCE — LIVE MARKET DATA ━━━${R}`);
  const t0 = Date.now();
  const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(10_000) });
  const priceData = await priceRes.json() as { price?: string };
  const btcPrice = parseFloat(priceData.price ?? '0');
  if (btcPrice <= 0) { console.error(`${FAIL} Binance returned invalid price: ${JSON.stringify(priceData)}`); process.exit(1); }
  console.log(`${PASS} BTCUSDT = ${B}$${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${R}  latency=${Date.now() - t0}ms`);

  const tw = Date.now();
  const whaleRes = await fetch('https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&limit=50', { signal: AbortSignal.timeout(10_000) });
  const trades = await whaleRes.json() as Array<{ p: string; q: string; T: number; m: boolean }>;
  const enriched = trades.map(t => ({ quoteQty: parseFloat(t.p) * parseFloat(t.q), qty: parseFloat(t.q), side: t.m ? 'SELL' : 'BUY', time: new Date(t.T).toISOString() }));
  const whale = enriched.reduce((a, b) => a.quoteQty > b.quoteQty ? a : b);
  console.log(`${PASS} Largest of last 50 aggTrades: side=${B}${whale.side}${R} qty=${whale.qty.toFixed(4)} BTC value=${B}$${Math.round(whale.quoteQty).toLocaleString()}${R} at ${whale.time}  latency=${Date.now() - tw}ms`);

  // ── [B] GROQ ─────────────────────────────────────────────────────────────────
  console.log(`\n${B}${M}━━━ [B] GROQ — llama-3.3-70b-versatile ━━━${R}`);
  const groqKey = sanitize(process.env.GROQ_API_KEY);
  if (!groqKey) { console.error(`${FAIL} GROQ_API_KEY not set`); process.exit(1); }
  const tg = Date.now();
  const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: 'Output ONLY valid JSON. No markdown.' }, { role: 'user', content: PROBE }], max_tokens: 60, temperature: 0 }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!gRes.ok) { const b = await gRes.text(); console.error(`${FAIL} Groq HTTP ${gRes.status}: ${b.slice(0, 300)}`); process.exit(1); }
  const gj = await gRes.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
  const gRaw = gj.choices?.[0]?.message?.content ?? '';
  console.log(`${INFO} Raw Groq response:    ${B}${gRaw}${R}`);
  const gCleaned = clean(gRaw);
  console.log(`${INFO} tripleCleanJsonString: ${gCleaned}`);
  const gParsed = JSON.parse(gCleaned);
  console.log(`${PASS} Groq PARSED OUTPUT:   ${B}${JSON.stringify(gParsed)}${R}  latency=${Date.now() - tg}ms`);
  console.log(`${INFO} Groq usage: ${JSON.stringify(gj.usage ?? {})}`);
  if (!(gParsed as { status?: unknown }).status) console.log(`${Y}[WARN] 'status' key missing from Groq response${R}`);
  else console.log(`${PASS} status = "${B}${(gParsed as { status: string }).status}${R}"`);

  // ── [C] GEMINI ───────────────────────────────────────────────────────────────
  console.log(`\n${B}${M}━━━ [C] GEMINI — gemini-3-flash-preview ━━━${R}`);
  const gemKey = sanitize(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!gemKey) { console.error(`${FAIL} GEMINI_API_KEY not set`); process.exit(1); }
  const RETIRED: Record<string, string> = { 'gemini-1.5-flash': 'gemini-3-flash-preview', 'gemini-2.0-flash': 'gemini-3-flash-preview', 'gemini-2.5-flash': 'gemini-3-flash-preview' };
  const rawModel = sanitize(process.env.GEMINI_MODEL_PRIMARY) || 'gemini-3-flash-preview';
  const model = RETIRED[rawModel] ?? rawModel;
  console.log(`${INFO} Resolved model: ${model} (env GEMINI_MODEL_PRIMARY="${rawModel}")`);
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(gemKey);
  const tm = Date.now();
  const mRes = await genAI.getGenerativeModel({ model }).generateContent(PROBE);
  const mRaw = mRes.response.text().trim();
  console.log(`${INFO} Raw Gemini response:   ${B}${mRaw}${R}`);
  const mCleaned = clean(mRaw);
  console.log(`${INFO} tripleCleanJsonString:  ${mCleaned}`);
  const mParsed = JSON.parse(mCleaned);
  console.log(`${PASS} Gemini PARSED OUTPUT:  ${B}${JSON.stringify(mParsed)}${R}  latency=${Date.now() - tm}ms`);
  if (!(mParsed as { status?: unknown }).status) console.log(`${Y}[WARN] 'status' key missing from Gemini response${R}`);
  else console.log(`${PASS} status = "${B}${(mParsed as { status: string }).status}${R}"`);

  // ── [D] ANTHROPIC ────────────────────────────────────────────────────────────
  console.log(`\n${B}${M}━━━ [D] ANTHROPIC — claude-3-5-sonnet-latest ━━━${R}`);
  const anthKey = sanitize(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (!anthKey) { console.error(`${FAIL} ANTHROPIC_API_KEY not set`); process.exit(1); }
  const models = ['claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'];
  let anthDone = false;
  for (const am of models) {
    console.log(`${INFO} Trying model=${am} ...`);
    const ta = Date.now();
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: am, max_tokens: 80, messages: [{ role: 'user', content: PROBE }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!aRes.ok) { console.log(`${Y}[WARN] ${am}: HTTP ${aRes.status}${R}`); continue; }
    const aj = await aRes.json() as { content?: Array<{ text?: string }>; usage?: unknown };
    const aRaw = aj.content?.[0]?.text?.trim() ?? '';
    console.log(`${INFO} Raw Anthropic response: ${B}${aRaw}${R}`);
    const aCleaned = clean(aRaw);
    console.log(`${INFO} tripleCleanJsonString:   ${aCleaned}`);
    const aParsed = JSON.parse(aCleaned);
    console.log(`${PASS} Anthropic PARSED OUTPUT: ${B}${JSON.stringify(aParsed)}${R}  model=${am}  latency=${Date.now() - ta}ms`);
    console.log(`${INFO} Anthropic usage: ${JSON.stringify(aj.usage ?? {})}`);
    if (!(aParsed as { status?: unknown }).status) console.log(`${Y}[WARN] 'status' key missing from Anthropic response${R}`);
    else console.log(`${PASS} status = "${B}${(aParsed as { status: string }).status}${R}"`);
    anthDone = true; break;
  }
  if (!anthDone) { console.error(`${FAIL} All Anthropic models failed`); process.exit(1); }

  // ── [E] PINECONE ─────────────────────────────────────────────────────────────
  console.log(`\n${B}${M}━━━ [E] PINECONE — dimension=768 assertion ━━━${R}`);
  const pcKey = sanitize(process.env.PINECONE_API_KEY);
  if (!pcKey) { console.error(`${FAIL} PINECONE_API_KEY not set`); process.exit(1); }
  const HARD = 'quantum-memory';
  let idxName = sanitize(process.env.PINECONE_INDEX_NAME) || HARD;
  if (/^\d+$/.test(idxName)) idxName = HARD;
  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey: pcKey });
  const tp = Date.now();
  const desc = await pc.describeIndex(idxName) as { dimension?: number; name?: string; status?: unknown; spec?: unknown };
  const descLat = Date.now() - tp;
  console.log(`${INFO} describeIndex raw: ${JSON.stringify({ name: desc.name, dimension: desc.dimension, status: desc.status })}`);
  if (desc.dimension !== 768) { console.error(`${FAIL} Pinecone dimension=${desc.dimension} — EXPECTED EXACTLY 768!`); process.exit(1); }
  console.log(`${PASS} dimension=${B}${desc.dimension}${R} (EXACT MATCH: 768)  latency=${descLat}ms`);
  const stats = await pc.index(idxName).describeIndexStats();
  console.log(`${PASS} totalVectors=${B}${stats.totalRecordCount ?? 0}${R}  index="${idxName}"`);
  console.log(`${INFO} Namespace breakdown: ${JSON.stringify(stats.namespaces ?? {})}`);

  console.log(`\n${B}${G}╔════════════════════════════════════════════════════════╗${R}`);
  console.log(`${B}${G}║  LOCAL SCAN COMPLETE — ALL 5 LOCAL CHECKS PASSED       ║${R}`);
  console.log(`${B}${G}╚════════════════════════════════════════════════════════╝${R}\n`);
}

main().catch(err => { console.error(`\n${FAIL} Unhandled:`, err); process.exit(1); });
