/**
 * Smart Agent Trader: shadow portfolio, post-mortem (תחקיר פוסט-מורטם), and confidence (מדד ביטחון).
 * Elite Terminal v1.3: Success/Failure Feedback — compares agent_insights + virtual_portfolio to adjust confidence and emit Pattern Warnings.
 * MoE: Historical context from agent_insights is consumed by ConsensusEngine (getDeepMemoryContext in lib/consensus-engine.ts) for the Debate Room.
 * Learning Center: Post-mortem generation uses Groq (Llama 3.3) primary, Gemini 3 Flash fallback; same prompt for both for consistent Pinecone embeddings.
 */

import Decimal from 'decimal.js';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { insertAgentInsight, listAgentInsightsBySymbol } from '@/lib/db/agent-insights';
import { storePostMortem } from '@/lib/vector-db';
import { listClosedVirtualTradesBySource, type VirtualPortfolioRow, type CloseReason } from '@/lib/db/virtual-portfolio';
import { fetchWithBackoff } from '@/lib/api-utils';
import { getGroqApiKey, getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { rsi, ema20, ema50 } from '@/lib/indicators';
import { toDecimal } from '@/lib/decimal';
import { GEMINI_CANONICAL_PRO_MODEL_ID, resolveGeminiModel } from '@/lib/gemini-model';
import { getAppSettings, resolveLlmTemperature } from '@/lib/db/app-settings';

const GROQ_POST_MORTEM_MODEL = 'llama-3.3-70b-versatile';
const POST_MORTEM_LLM_TIMEOUT_MS = 12_000;

/** Extract JSON string from model text (handles markdown fences and trailing text). Same logic for Groq and Gemini for consistent parsing. */
function extractJsonFromText(text: string): string {
  const trimmed = (text || '').trim();
  let str = trimmed;
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/i, '').replace(/(?:\r?\n)?\s*```\s*$/, '').trim();
  }
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) return str.slice(start, end);
  const match = str.match(/\{[\s\S]*\}/);
  return match ? match[0] : str;
}

export interface GeneratedPostMortem {
  why_win_lose: string;
  insight: string;
  agent_verdict: string;
}

/** Result of Success/Failure Feedback: pattern warnings and optional confidence penalty (0–100 points). */
export interface SuccessFailureFeedback {
  patternWarnings: string[];
  confidencePenalty: number;
}

/**
 * Success/Failure Feedback (Agent Reflex): compare past "Elite" predictions with actual PnL.
 * Queries agent_insights and virtual_portfolio; if a pattern (e.g. High RSI + Volume Spike) consistently fails,
 * returns pattern warnings and a confidence penalty for future analyses.
 */
export async function getSuccessFailureFeedback(symbol: string): Promise<SuccessFailureFeedback> {
  const normalized = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const patternWarnings: string[] = [];
  let confidencePenalty = 0;

  try {
    const [insights, closedTrades] = await Promise.all([
      listAgentInsightsBySymbol(normalized, 80),
      listClosedVirtualTradesBySource('agent', normalized, 80),
    ]);

    const failureInsights = insights.filter(
      (i) =>
        i.insight &&
        (i.insight.includes('נכשלה') || i.insight.includes('סטופ לוס') || i.insight.includes('ניקוי') || i.insight.includes('כשלון'))
    );

    const failurePatterns: Record<string, number> = {};
    for (const ins of failureInsights) {
      if (ins.entry_conditions && ins.insight) {
        const text = `${ins.entry_conditions} ${ins.insight}`.toLowerCase();
        if (text.includes('rsi') || text.includes('מומנטום')) failurePatterns['high_rsi_momentum'] = (failurePatterns['high_rsi_momentum'] ?? 0) + 1;
        if (text.includes('volume') || text.includes('נפח')) failurePatterns['volume_spike'] = (failurePatterns['volume_spike'] ?? 0) + 1;
        if (text.includes('נפח') && text.includes('rsi')) failurePatterns['rsi_volume_combo'] = (failurePatterns['rsi_volume_combo'] ?? 0) + 1;
      }
    }

    const totalFailures = failureInsights.length;
    const totalClosed = closedTrades.length;
    const failRate = totalClosed > 0 ? totalFailures / totalClosed : 0;

    if (failRate >= 0.5 && totalClosed >= 3) {
      confidencePenalty = Math.min(25, Math.round(failRate * 30));
    }
    if (failurePatterns['rsi_volume_combo'] >= 2) {
      patternWarnings.push('אזהרת דפוס: RSI גבוה יחד עם נפח חריג קשור לכישלונות חוזרים — שקול להפחית ביטחון או לדרוש אימות נוסף.');
    }
    if (failurePatterns['high_rsi_momentum'] >= 3) {
      patternWarnings.push('אזהרת דפוס: כניסות במומנטום/RSI גבוה נכשלו פעמים רבות — הוסף אימות על יותר מזמנים או הורד משקל הסתברות.');
    }
    if (failurePatterns['volume_spike'] >= 3) {
      patternWarnings.push('אזהרת דפוס: נפח חריג בלי אימות טרנד עלול להוביל לכישלון — דרוש אישור על 2+ timeframes.');
    }
  } catch {
    // DB or network failure — no penalty, no warnings
  }

  return { patternWarnings, confidencePenalty };
}

/** Fetch RSI(14) for symbol from recent klines (for post-mortem insight). */
async function fetchRsiForSymbol(symbol: string): Promise<number | null> {
  try {
    const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
    const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=30`;
    const res = await fetchWithBackoff(url, { timeoutMs: 6000, maxRetries: 2, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
    const closes = data
      .filter((row) => Array.isArray(row) && row.length >= 5)
      .map((row) => parseFloat((row as unknown as Record<number, string>)[4]));
    if (closes.length < 15) return null;
    return rsi(closes, 14);
  } catch {
    return null;
  }
}

/**
 * Build the single post-mortem prompt used by both Groq and Gemini.
 * Identical structure ensures consistent vector embeddings for Pinecone.
 */
function buildPostMortemPrompt(params: {
  symbol: string;
  entryConditions: string;
  outcome: string;
  closeReason: CloseReason;
  pnlPct: number;
  rsiVal: number | null;
  techScore?: number | null;
  riskScore?: number | null;
  psychScore?: number | null;
  macroScore?: number | null;
}): string {
  const { symbol, entryConditions, outcome, closeReason, pnlPct, rsiVal, techScore, riskScore, psychScore, macroScore } = params;
  const rsiLine = rsiVal != null ? `RSI(14) at close/entry: ${rsiVal.toFixed(1)}.` : 'RSI not available.';
  const moeLine = [techScore, riskScore, psychScore, macroScore].some((s) => s != null && Number.isFinite(s))
    ? `MoE scores: tech=${techScore ?? 'N/A'}, risk=${riskScore ?? 'N/A'}, psych=${psychScore ?? 'N/A'}, macro=${macroScore ?? 'N/A'}.`
    : 'MoE scores not stored for this trade.';
  return `You are an Elite Quantitative Analyst writing a short post-mortem (תחקיר פוסט-מורטם) for a closed crypto trade. All output must be in fluent Hebrew.

Trade context:
- Symbol: ${symbol}
- Entry conditions: ${entryConditions}
- Outcome: ${outcome}
- Close reason: ${closeReason}
- PnL: ${pnlPct.toFixed(2)}%
- ${rsiLine}
- ${moeLine}

Respond with ONLY a single valid JSON object, no markdown, no explanation. Use exactly these keys:
{"why_win_lose": "<string: brief analysis of why the trade won or lost, in Hebrew>", "insight": "<string: one-sentence insight for the learning center, in Hebrew>", "agent_verdict": "<string: which MoE agents were right/wrong if scores present, otherwise state unavailable, in Hebrew>"}`;
}

/**
 * Generate post-mortem via LLM: Groq (Llama 3.3) primary, Gemini 3 Flash fallback.
 * Same prompt is sent to both for consistent Pinecone embeddings; output is parsed with extractJsonFromText.
 */
export async function generatePostMortem(
  trade: VirtualPortfolioRow & { tech_score?: number | null; risk_score?: number | null; psych_score?: number | null; macro_score?: number | null },
  exitPrice: number,
  closeReason: CloseReason,
  pnlPct: number,
  rsiVal: number | null
): Promise<GeneratedPostMortem> {
  const pmTemp = resolveLlmTemperature(await getAppSettings());
  const entryConditions = `entry_price=${trade.entry_price}, target=${trade.target_profit_pct}%, stop=${trade.stop_loss_pct}%`;
  const outcome = `exit_price=${exitPrice}, reason=${closeReason}, pnl_pct=${pnlPct.toFixed(2)}%`;
  const prompt = buildPostMortemPrompt({
    symbol: trade.symbol,
    entryConditions,
    outcome,
    closeReason,
    pnlPct,
    rsiVal,
    techScore: trade.tech_score,
    riskScore: trade.risk_score,
    psychScore: trade.psych_score,
    macroScore: trade.macro_score,
  });

  const parseResponse = (raw: string): GeneratedPostMortem => {
    const jsonStr = extractJsonFromText(raw);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const why_win_lose = typeof parsed.why_win_lose === 'string' ? parsed.why_win_lose : String(parsed.why_win_lose ?? '').slice(0, 2000);
    const insight = typeof parsed.insight === 'string' ? parsed.insight : String(parsed.insight ?? '').slice(0, 1000);
    const agent_verdict = typeof parsed.agent_verdict === 'string' ? parsed.agent_verdict : String(parsed.agent_verdict ?? '').slice(0, 1000);
    return { why_win_lose, insight, agent_verdict };
  };

  const groqKey = getGroqApiKey();
  if (groqKey) {
    try {
      const groqAc = new AbortController();
      const groqTimer = setTimeout(() => groqAc.abort(), POST_MORTEM_LLM_TIMEOUT_MS);
      const groq = new Groq({ apiKey: groqKey });
      let completion: Awaited<ReturnType<typeof groq.chat.completions.create>>;
      try {
        completion = await groq.chat.completions.create(
          {
            model: GROQ_POST_MORTEM_MODEL,
            messages: [
              {
                role: 'system',
                content:
                  'You output only valid JSON. No markdown, no code fences, no extra text. Keys: why_win_lose, insight, agent_verdict (all strings, Hebrew).',
              },
              { role: 'user', content: prompt },
            ],
            temperature: pmTemp,
            max_tokens: 1024,
          },
          { signal: groqAc.signal }
        );
      } finally {
        clearTimeout(groqTimer);
      }
      const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
      if (raw) {
        const result = parseResponse(raw);
        return result;
      }
    } catch (_) {
      // Fall through to Gemini fallback
    }
  }
  if (!groqKey) {
    console.error('[CRITICAL] Grok/Groq API key missing during smart-agent post-mortem initialization. Expected GROQ_API_KEY.');
  }

  try {
    const geminiKey = getGeminiApiKey();
    const genAI = new GoogleGenerativeAI(geminiKey);
    const selectedGeminiModel = resolveGeminiModel(
      APP_CONFIG.fallbackModel || GEMINI_CANONICAL_PRO_MODEL_ID
    );
    const model = genAI.getGenerativeModel(
      {
        model: selectedGeminiModel.model,
      },
      selectedGeminiModel.requestOptions
    );
    const gemAc = new AbortController();
    const gemTimer = setTimeout(() => gemAc.abort(), POST_MORTEM_LLM_TIMEOUT_MS);
    let res: Awaited<ReturnType<typeof model.generateContent>>;
    try {
      res = await model.generateContent(
        {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `You output only valid JSON. No markdown, no code fences, no extra text. Keys: why_win_lose, insight, agent_verdict (all strings, Hebrew).\n\n${prompt}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: pmTemp, maxOutputTokens: 1024 },
        },
        { signal: gemAc.signal }
      );
    } finally {
      clearTimeout(gemTimer);
    }
    const raw = res.response.text()?.trim() ?? '';
    if (raw) {
      const result = parseResponse(raw);
      return result;
    }
    console.warn('[Learning Center] Gemini fallback returned empty response.');
  } catch (e) {
    console.warn('[Learning Center] Gemini fallback failed:', e instanceof Error ? e.message : e);
  }

  throw new Error('Learning Center: both Groq and Gemini post-mortem generation failed');
}

/** Build structured "why did this trade win/lose" for RAG (God-Mode). Deterministic fallback when LLM is unavailable. */
function buildWhyWinLose(closeReason: CloseReason, pnlPct: number, rsiVal: number | null): string {
  const won = pnlPct > 0;
  if (closeReason === 'take_profit') {
    return `העסקה ניצחה: הגעה ליעד רווח (TP). המחיר הגיע ליעד שהוגדר מראש. רווח ${pnlPct.toFixed(2)}%.`;
  }
  if (closeReason === 'stop_loss') {
    const rsiNote = rsiVal != null ? ` RSI בסגירה/כניסה ${rsiVal.toFixed(1)} — מומנטום מתוח או היפוך.` : ' כניסה במומנטום חלש או ללא אימות נפח/תמיכה.';
    return `העסקה הפסידה: פגיעה בסטופ לוס.${rsiNote} יש לבחון אזור כניסה ו-R:R.`;
  }
  if (closeReason === 'liquidation') {
    return 'העסקה נסגרה בניקוי: הפסד קיצוני. תנאי כניסה או גודל פוזיציה לא תואמים; יש להחמיר ניהול סיכון.';
  }
  if (won) {
    return `סגירה ידנית ברווח: ${pnlPct.toFixed(2)}%. המשתמש או הרובוט סגר בעדיפות ליעד.`;
  }
  return `סגירה ידנית בהפסד: ${pnlPct.toFixed(2)}%. תחקיר: בדוק RSI בכניסה, נפח, ו-EMA.`;
}

/** Build "which agent was right/wrong" when MoE scores are available (God-Mode). */
function buildAgentVerdict(
  pnlPct: number,
  tech?: number | null,
  risk?: number | null,
  psych?: number | null,
  macro?: number | null
): string {
  const won = pnlPct > 0;
  const hasScores = [tech, risk, psych, macro].some((x) => x != null && Number.isFinite(x));
  if (!hasScores) {
    return 'לא נשמרו ציוני MoE בפתיחת העסקה. מומלץ לפתוח עסקאות מהאנליזר עם שמירת ציונים להעשרת RAG.';
  }
  const parts: string[] = [];
  if (tech != null && Number.isFinite(tech)) {
    const techRight = won ? tech >= 60 : tech < 60;
    parts.push(`טכני (${tech}): ${techRight ? 'צדק' : 'טעה'}.`);
  }
  if (risk != null && Number.isFinite(risk)) {
    const riskRight = won ? risk >= 50 : risk < 50;
    parts.push(`סיכון (${risk}): ${riskRight ? 'צדק' : 'טעה'}.`);
  }
  if (psych != null && Number.isFinite(psych)) {
    parts.push(`פסיכ (${psych}): ${(won && psych >= 50) || (!won && psych < 50) ? 'צדק' : 'טעה'}.`);
  }
  if (macro != null && Number.isFinite(macro)) {
    parts.push(`מקרו (${macro}): ${(won && macro >= 50) || (!won && macro < 50) ? 'צדק' : 'טעה'}.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'ציוני MoE לא זמינים.';
}

/** Run post-mortem for a closed agent trade and store insight (God-Mode: why_win_lose + agent_verdict for RAG). Primary: Groq; fallback: Gemini; then deterministic. */
export async function runPostMortemForClosedTrade(
  trade: VirtualPortfolioRow & {
    tech_score?: number | null;
    risk_score?: number | null;
    psych_score?: number | null;
    macro_score?: number | null;
    onchain_score?: number | null;
    deep_memory_score?: number | null;
  },
  exitPrice: number,
  closeReason: CloseReason,
  pnlPct: number
): Promise<void> {
  const entryConditions = `entry_price=${trade.entry_price}, target=${trade.target_profit_pct}%, stop=${trade.stop_loss_pct}%`;
  const outcome = `exit_price=${exitPrice}, reason=${closeReason}, pnl_pct=${pnlPct.toFixed(2)}%`;
  const rsiVal = closeReason === 'stop_loss' || pnlPct < 0 ? await fetchRsiForSymbol(trade.symbol) : null;

  let insight: string;
  let whyWinLose: string;
  let agentVerdict: string;

  try {
    const generated = await generatePostMortem(trade, exitPrice, closeReason, pnlPct, rsiVal);
    insight = generated.insight;
    whyWinLose = generated.why_win_lose;
    agentVerdict = generated.agent_verdict;
  } catch {
    insight =
      closeReason === 'take_profit'
        ? `עסקה הצליחה: הגעה ליעד רווח. רווח ${pnlPct.toFixed(2)}%.`
        : closeReason === 'stop_loss'
          ? rsiVal != null
            ? `עסקה נכשלה: סטופ לוס. זיהוי מומנטום מתוח (RSI = ${rsiVal.toFixed(1)}) — סיכון גבוה להיפוך מחיר.`
            : `עסקה נכשלה: סטופ לוס. RSI גבוה בכניסה או חוסר תמיכת נפח עלולים להסביר.`
          : closeReason === 'liquidation'
            ? `עסקה נסגרה בניקוי: הפסד קיצוני. יש לבחון תנאי כניסה וניהול סיכון.`
            : `עסקה נסגרה ידנית. רווח/הפסד: ${pnlPct.toFixed(2)}%.`;
    if (pnlPct < 0 && closeReason !== 'stop_loss') {
      insight += rsiVal != null
        ? ` תחקיר: זיהוי מומנטום מתוח (RSI = ${rsiVal.toFixed(1)}) — סיכון גבוה להיפוך מחיר.`
        : ` תחקיר פוסט-מורטם: כשלון — נבדוק RSI בכניסה, נפח ו-EMA.`;
    }
    whyWinLose = buildWhyWinLose(closeReason, pnlPct, rsiVal);
    agentVerdict = buildAgentVerdict(pnlPct, trade.tech_score, trade.risk_score, trade.psych_score, trade.macro_score);
  }

  await insertAgentInsight({
    symbol: trade.symbol,
    trade_id: trade.id,
    entry_conditions: entryConditions,
    outcome,
    insight,
    // Expert scores persisted here power getExpertHitRates30d/7d in lib/db/expert-accuracy.ts,
    // which feeds the dynamic MoE weights in consensus-engine.ts.
    // Without these fields the Learning Center shows 0/0 and all hit rates default to 50%.
    tech_score: trade.tech_score ?? null,
    risk_score: trade.risk_score ?? null,
    psych_score: trade.psych_score ?? null,
    macro_score: trade.macro_score ?? null,
    onchain_score: trade.onchain_score ?? null,
    deep_memory_score: trade.deep_memory_score ?? null,
    why_win_lose: whyWinLose,
    agent_verdict: agentVerdict,
  });
  if (whyWinLose?.trim()) {
    try {
      const ragText = `Trade Post-Mortem [${trade.symbol} trade_id=${trade.id}]: ${whyWinLose}`.trim();
      await storePostMortem(ragText, {
        symbol: trade.symbol,
        trade_id: trade.id,
        created_at: new Date().toISOString(),
        outcome,
      });
    } catch (upsertErr) {
      console.error('[smart-agent] Pinecone upsert failed for post-mortem:', upsertErr);
    }
  }
}

const POST_MORTEM_TIMEOUT_MS = 10_000;

/**
 * Run post-mortem with a 10-second timeout. On timeout or failure, log "Pending Insight"
 * and insert a placeholder insight so trade closure is not blocked.
 */
export function runPostMortemWithTimeout(
  trade: VirtualPortfolioRow & {
    tech_score?: number | null;
    risk_score?: number | null;
    psych_score?: number | null;
    macro_score?: number | null;
    onchain_score?: number | null;
    deep_memory_score?: number | null;
  },
  exitPrice: number,
  closeReason: CloseReason,
  pnlPct: number
): void {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('Post-mortem timeout')), POST_MORTEM_TIMEOUT_MS)
  );
  Promise.race([runPostMortemForClosedTrade(trade, exitPrice, closeReason, pnlPct), timeout])
    .catch((e) => {
      console.warn('[smart-agent] Post-mortem failed or timed out — logging Pending Insight:', e instanceof Error ? e.message : e);
      insertAgentInsight({
        symbol: trade.symbol,
        trade_id: trade.id,
        entry_conditions: `entry_price=${trade.entry_price}, target=${trade.target_profit_pct}%, stop=${trade.stop_loss_pct}%`,
        outcome: `exit_price=${exitPrice}, reason=${closeReason}, pnl_pct=${pnlPct.toFixed(2)}%`,
        insight: 'תובנה בהמתנה (Pending Insight) — תחקיר פוסט-מורטם לא הושלם בשל timeout או שגיאה.',
        tech_score: trade.tech_score ?? null,
        risk_score: trade.risk_score ?? null,
        psych_score: trade.psych_score ?? null,
        macro_score: trade.macro_score ?? null,
        onchain_score: trade.onchain_score ?? null,
        deep_memory_score: trade.deep_memory_score ?? null,
        why_win_lose: null,
        agent_verdict: null,
      }).catch((insertErr) =>
        console.error('[smart-agent] Failed to insert Pending Insight:', insertErr)
      );
    });
}

/** Bullish Engulfing on last two candles (opens, closes). */
function isBullishEngulfing(opens: number[], closes: number[]): boolean {
  if (opens.length < 2 || closes.length < 2) return false;
  const o1 = opens[opens.length - 2]!;
  const c1 = closes[opens.length - 2]!;
  const o2 = opens[opens.length - 1]!;
  const c2 = closes[opens.length - 1]!;
  const prevRed = c1 < o1;
  const currGreen = c2 > o2;
  const engulfs = o2 <= c1 && c2 >= o1 && c2 > o1 && o2 < c1;
  return prevRed && currGreen && engulfs;
}

/**
 * Agent confidence (מדד ביטחון) 0–100 for a symbol.
 * Uses Decimal.js for volatility/score to avoid floating-point drift.
 * +10 when Bullish Engulfing (Elite-style bonus).
 */
export async function getAgentConfidence(symbol: string): Promise<number> {
  const normalized = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const closed = await listClosedVirtualTradesBySource('agent', normalized, 50);
  let winRateComponent = 50;
  if (closed.length > 0) {
    const wins = closed.filter((t) => t.pnl_pct != null && t.pnl_pct > 0).length;
    winRateComponent = (wins / closed.length) * 100;
  }

  let volatilityComponent = 70;
  let alignmentComponent = 50;
  let engulfingBonus = 0;
  try {
    const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
    const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(normalized)}&interval=1d&limit=60`;
    const res = await fetchWithBackoff(url, { timeoutMs: 8000, maxRetries: 2, cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
      const closes = data
        .filter((row) => Array.isArray(row) && row.length >= 5)
        .map((row) => parseFloat((row as unknown as Record<number, string>)[4]));
      const opens = data
        .filter((row) => Array.isArray(row) && row.length >= 2)
        .map((row) => parseFloat((row as unknown as Record<number, string>)[1]));
      if (closes.length >= 20) {
        const returns = closes.slice(1).map((c, i) => (c - closes[i]!) / (closes[i]! || 1));
        const n = toDecimal(returns.length);
        const sum = returns.reduce((a, b) => a.plus(toDecimal(b)), toDecimal(0));
        const mean = sum.div(n);
        const variance = returns.reduce(
          (acc, r) => acc.plus(toDecimal(r).minus(mean).pow(2)),
          toDecimal(0)
        ).div(n);
        const stdDev = variance.sqrt();
        const volPct = Decimal.min(1, stdDev.abs().times(100));
        volatilityComponent = Math.max(0, 100 - volPct.toNumber() * 50);

        const rsiVal = rsi(closes, 14);
        const ema20Val = ema20(closes);
        const ema50Val = ema50(closes);
        const price = closes[closes.length - 1]!;
        const priceAboveEma20 = ema20Val != null && price > ema20Val;
        const rsiNotOverbought = rsiVal < 70;
        const bullishTrend = ema20Val != null && ema50Val != null && ema20Val > ema50Val;
        alignmentComponent = (priceAboveEma20 && rsiNotOverbought ? 40 : 0) + (bullishTrend ? 60 : 0);
        if (alignmentComponent === 0) alignmentComponent = 30;

        if (isBullishEngulfing(opens, closes)) engulfingBonus = 10;
      }
    }
  } catch {
    // keep defaults
  }

  let score = toDecimal(winRateComponent)
    .times(0.5)
    .plus(toDecimal(volatilityComponent).times(0.3))
    .plus(toDecimal(alignmentComponent).times(0.2))
    .plus(engulfingBonus)
    .round()
    .toNumber();

  const feedback = await getSuccessFailureFeedback(normalized);
  score = Math.max(0, Math.min(100, score - feedback.confidencePenalty));

  return score;
}
