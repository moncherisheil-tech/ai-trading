/**
 * Whale Alert AI Orchestrator
 *
 * Receives a parsed WhaleAlert from the Redis subscriber and fires an LLM
 * evaluation via Groq (low-latency Llama 3) with Gemini as the fallback.
 * Intentionally bypasses the `IS_LIVE_MODE` gate — this is a dedicated
 * background analysis pipeline, not a user-facing request.
 *
 * Every successful analysis is persisted to the `EpisodicMemory` table as
 * a WHALE_ANALYSIS / MARKET_INTELLIGENCE record.
 */
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { WhaleAlert } from '@/lib/redis/whale-subscriber';
import { getGroqApiKey, getGeminiApiKey } from '@/lib/env';
import { resolveGeminiModel, withGeminiRateLimitRetry } from '@/lib/gemini-model';
import { prisma } from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/notifications/telegram';

const SEPARATOR = '━'.repeat(60);

/** Maximum ms we will wait for a cross-provider DB write (Israel → 178.104.75.47). */
const DB_WRITE_TIMEOUT_MS = 8_000;

/**
 * Races `promise` against a hard deadline.
 * Rejects with an error whose message begins with `errorCode` so downstream
 * log scrapers can identify the failure class without parsing free-form text.
 */
function withDbTimeout<T>(promise: Promise<T>, ms: number, errorCode: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${errorCode}: DB write to 178.104.75.47 timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

function buildPrompt(alert: WhaleAlert): { system: string; user: string } {
  const { symbol, anomaly_type, delta_pct, timestamp } = alert;
  const direction = delta_pct > 0 ? 'spike' : 'collapse';
  const magnitude = Math.abs(delta_pct).toFixed(2);

  const user =
    `A sudden liquidity ${direction} of ${magnitude}% occurred on ${symbol} at ${timestamp}. ` +
    `Anomaly classification from the ingestion engine: "${anomaly_type}". ` +
    `Based on institutional order flow mechanics, evaluate if this is likely spoofing, ` +
    `legitimate accumulation, or aggressive distribution. ` +
    `Provide a concise 2–3 sentence institutional-grade assessment and a confidence level (low / medium / high).`;

  const system =
    'You are a quantitative analyst specializing in market microstructure and institutional order flow. ' +
    'Respond in precise, concise English. Output only the assessment — no preamble, no markdown.';

  return { system, user };
}

async function callGroq(system: string, user: string): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) throw new Error('GROQ_API_KEY not available');

  const client = new Groq({ apiKey });
  const completion = await client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    temperature: 0.25,
    max_tokens: 280,
  });
  return (completion.choices?.[0]?.message?.content || '').trim();
}

async function callGemini(system: string, user: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const selected = resolveGeminiModel(process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.0-flash-exp');
  const model = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);

  const response = await withGeminiRateLimitRetry(() =>
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 280 },
    })
  );
  return (response.response.text() || '').trim();
}

export async function analyzeWhaleAlert(alert: WhaleAlert): Promise<void> {
  const { symbol, anomaly_type, delta_pct, timestamp } = alert;

  console.log(`\n[WhaleAnalysis] ${SEPARATOR}`);
  console.log(`[WhaleAnalysis] ALERT  : ${anomaly_type.toUpperCase()} on ${symbol}`);
  console.log(`[WhaleAnalysis] DELTA  : ${delta_pct > 0 ? '+' : ''}${delta_pct.toFixed(2)}%`);
  console.log(`[WhaleAnalysis] TIME   : ${timestamp}`);
  console.log(`[WhaleAnalysis] STATUS : Dispatching to AI...`);

  const { system, user } = buildPrompt(alert);

  let assessment: string | null = null;
  let provider = 'groq';

  try {
    assessment = await callGroq(system, user);
  } catch (groqErr) {
    console.warn(
      `[WhaleAnalysis] Groq unavailable (${groqErr instanceof Error ? groqErr.message : groqErr}), ` +
      'falling back to Gemini...'
    );
    provider = 'gemini';
    try {
      assessment = await callGemini(system, user);
    } catch (geminiErr) {
      console.error(
        '[WhaleAnalysis] All AI providers failed:',
        geminiErr instanceof Error ? geminiErr.message : geminiErr
      );
      return;
    }
  }

  console.log(`[WhaleAnalysis] PROVIDER: ${provider.toUpperCase()}`);
  console.log(`[WhaleAnalysis] RESULT :`);
  console.log(`  ${assessment}`);
  console.log(`[WhaleAnalysis] ${SEPARATOR}\n`);

  // ── Persist to Episodic Memory ────────────────────────────────────────────
  // Schema fields used:
  //   marketRegime  → type identifier  ("WHALE_ANALYSIS")
  //   symbol        → alert.symbol
  //   abstractLesson→ full AI content  (category header + assessment + metadata)
  //
  // The write is raced against DB_WRITE_TIMEOUT_MS so a stalled TCP connection
  // to 178.104.75.47 never blocks the subscriber pipeline indefinitely.
  try {
    const metadata = JSON.stringify({
      delta_pct,
      anomaly_type,
      timestamp,
      source: 'Binance_L2_Rust',
    });

    const abstractLesson =
      `[CATEGORY: MARKET_INTELLIGENCE]\n\n${assessment}\n\n[METADATA: ${metadata}]`;

    console.log('[WhaleAnalysis] DEBUG: Starting DB save to 178.104.75.47...');

    const record = await withDbTimeout(
      prisma.episodicMemory.create({
        data: {
          symbol,
          marketRegime: 'WHALE_ANALYSIS',
          abstractLesson,
        },
      }),
      DB_WRITE_TIMEOUT_MS,
      'DB_UNREACHABLE_WS1'
    );

    console.log(`[WhaleAnalysis] SUCCESS: Analysis saved — EpisodicMemory Record ID: ${record.id}`);

    // ── Fire-and-forget Telegram alert ──────────────────────────────────────
    const direction = delta_pct > 0 ? '📈 SPIKE' : '📉 COLLAPSE';
    const magnitude = Math.abs(delta_pct).toFixed(2);
    const snippet   = assessment.length > 220
      ? assessment.slice(0, 220).trimEnd() + '…'
      : assessment;

    const telegramMsg = [
      '🐋 <b>QUANTUM WHALE ALERT</b> 🐋',
      '',
      `<b>Symbol:</b>  <code>${symbol}</code>`,
      `<b>Event:</b>   ${direction}  <code>${delta_pct > 0 ? '+' : ''}${magnitude}%</code>`,
      `<b>Regime:</b>  <code>${anomaly_type}</code>`,
      `<b>Provider:</b> ${provider.toUpperCase()}`,
      '',
      `<b>📋 Assessment:</b>`,
      snippet,
      '',
      `<i>🕐 ${new Date(timestamp).toUTCString()}</i>`,
    ].join('\n');

    void sendTelegramMessage(telegramMsg).then((sent) => {
      if (!sent) console.warn('[WhaleAnalysis] Telegram alert was not delivered (non-fatal).');
    });
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    const isTimeout = msg.startsWith('DB_UNREACHABLE_WS1');
    console.error(
      `[WhaleAnalysis] DB write FAILED (non-fatal) — ${isTimeout ? 'TIMEOUT/ROUTE_ERROR' : 'QUERY_ERROR'}: ${msg}`
    );
  }
}
