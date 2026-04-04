/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║     QUANTUM OMEGA GOD-CLASS ORCHESTRATOR  ·  Level 100,000      ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Single source of truth for ALL AI calls and ALL DB operations. ║
 * ║  No component, route, or worker may bypass this module.         ║
 * ║                                                                  ║
 * ║  PIPELINE (Phase 3 — MoE Workflow):                             ║
 * ║   1. Zod validation        → drop invalid / mock signals        ║
 * ║   2. DB Boot               → ensureAllTablesExist() once        ║
 * ║   3. EpisodicMemory        → Pinecone context fetch             ║
 * ║   4. Fan-out (Board)       → 7 experts via Promise.allSettled   ║
 * ║   5. Fault Tolerance       → failed experts skipped, not crash  ║
 * ║   6. Fan-in (CEO)          → Overseer synthesizes verdict       ║
 * ║   7. Execution             → Trading Robot on TRADE only        ║
 * ║   8. NeuroPlasticity       → post-mortem → Pinecone + Postgres  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { z } from 'zod';
import type { Job } from 'bullmq';
import { runDbBootstrapper } from '@/lib/core/db-bootstrapper';
import { queryRaw } from '@/lib/db/sql';
import { writeAudit } from '@/lib/audit';

// ─── Zod Validation Schema ─────────────────────────────────────────────────
// Enforces real data. Rejects mock/test payloads and malformed signals.

const KNOWN_SYMBOLS_RE = /^[A-Z]{2,12}USDT$/;
const MAX_DELTA_PCT = 999;
const MIN_DELTA_PCT = -999;

export const WhaleSignalSchema = z.object({
  symbol: z
    .string()
    .min(5)
    .max(20)
    .regex(KNOWN_SYMBOLS_RE, 'Symbol must be a valid USDT pair (e.g. BTCUSDT)')
    .refine((s) => !['SAMPLEUSDT', 'TESTUSDT', 'MOCKUSDT', 'DUMMYUSDT'].includes(s), {
      message: 'VALIDATION_FAILED: Mock/sample symbol detected — signal dropped',
    }),
  anomaly_type: z.string().min(1).max(64),
  delta_pct: z
    .number()
    .finite()
    .min(MIN_DELTA_PCT)
    .max(MAX_DELTA_PCT)
    .refine((v) => v !== 0, { message: 'VALIDATION_FAILED: delta_pct cannot be zero' }),
  timestamp: z.string().min(1),
});

export type ValidatedWhaleSignal = z.infer<typeof WhaleSignalSchema>;

// ─── DB Boot: ensureAllTablesExist ─────────────────────────────────────────
// Delegates to the central db-bootstrapper. The bootstrapper is idempotent
// (module-level promise cache) so calling this from BullMQ workers is safe.

export async function ensureAllTablesExist(): Promise<void> {
  await runDbBootstrapper();
}

// Retained for reference — no longer used directly; DDL is in db-bootstrapper.ts
async function _runAllDDL(): Promise<void> {
  console.log('[Orchestrator] ⚡ Sequential DB boot — initializing all tables...');
  const t0 = Date.now();

  const steps: Array<{ name: string; ddl: string[] }> = [
    {
      name: 'prediction_records',
      ddl: [
        `CREATE TABLE IF NOT EXISTS prediction_records (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          status TEXT NOT NULL,
          prediction_date TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_prediction_records_symbol ON prediction_records(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_prediction_records_status ON prediction_records(status)`,
        `CREATE INDEX IF NOT EXISTS idx_prediction_records_prediction_date ON prediction_records(prediction_date DESC)`,
      ],
    },
    {
      name: 'board_meeting_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS board_meeting_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('morning','evening','whale')),
          the_7_expert_verdicts JSONB NOT NULL,
          overseer_final_action_plan TEXT NOT NULL,
          market_context JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_timestamp ON board_meeting_logs(timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_trigger_type ON board_meeting_logs(trigger_type)`,
      ],
    },
    {
      name: 'agent_insights',
      ddl: [
        `CREATE TABLE IF NOT EXISTS agent_insights (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          trade_id INTEGER NOT NULL DEFAULT 0,
          entry_conditions TEXT,
          outcome TEXT,
          insight TEXT NOT NULL,
          tech_score INTEGER,
          risk_score INTEGER,
          psych_score INTEGER,
          macro_score INTEGER,
          onchain_score INTEGER,
          deep_memory_score INTEGER,
          master_insight TEXT,
          reasoning_path TEXT,
          why_win_lose TEXT,
          agent_verdict TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_agent_insights_symbol ON agent_insights(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_agent_insights_created_at ON agent_insights(created_at DESC)`,
      ],
    },
    {
      name: 'virtual_portfolio',
      ddl: [
        `CREATE TABLE IF NOT EXISTS virtual_portfolio (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          direction VARCHAR(8) NOT NULL DEFAULT 'LONG',
          entry_price NUMERIC(18,8) NOT NULL,
          quantity NUMERIC(18,8) NOT NULL,
          usd_size NUMERIC(18,2) NOT NULL,
          stop_loss NUMERIC(18,8),
          take_profit NUMERIC(18,8),
          status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
          opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ,
          exit_price NUMERIC(18,8),
          pnl_usd NUMERIC(18,4),
          pnl_pct NUMERIC(10,4),
          prediction_id TEXT,
          notes TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_symbol ON virtual_portfolio(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_status ON virtual_portfolio(status)`,
      ],
    },
    {
      name: 'virtual_trades_history',
      ddl: [
        `CREATE TABLE IF NOT EXISTS virtual_trades_history (
          id SERIAL PRIMARY KEY,
          trade_id INTEGER NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          event_type VARCHAR(32) NOT NULL,
          price NUMERIC(18,8),
          quantity NUMERIC(18,8),
          usd_value NUMERIC(18,2),
          execution_mode VARCHAR(16),
          broker TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_vth_trade_id ON virtual_trades_history(trade_id)`,
        `CREATE INDEX IF NOT EXISTS idx_vth_symbol ON virtual_trades_history(symbol)`,
      ],
    },
    {
      name: 'scanner_alert_log',
      ddl: [
        `CREATE TABLE IF NOT EXISTS scanner_alert_log (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          alert_type VARCHAR(32),
          confidence NUMERIC(5,2),
          payload JSONB,
          alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_sal_symbol ON scanner_alert_log(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_sal_alerted_at ON scanner_alert_log(alerted_at DESC)`,
      ],
    },
    {
      name: 'prediction_weights',
      ddl: [
        `CREATE TABLE IF NOT EXISTS prediction_weights (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          volume_weight NUMERIC(5,4),
          rsi_weight NUMERIC(5,4),
          sentiment_weight NUMERIC(5,4),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_pw_symbol ON prediction_weights(symbol)`,
      ],
    },
    {
      name: 'historical_predictions',
      ddl: [
        `CREATE TABLE IF NOT EXISTS historical_predictions (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          direction VARCHAR(8),
          confidence NUMERIC(5,2),
          predicted_at TIMESTAMPTZ NOT NULL,
          evaluated_at TIMESTAMPTZ,
          outcome VARCHAR(16),
          payload JSONB
        )`,
        `CREATE INDEX IF NOT EXISTS idx_hp_symbol ON historical_predictions(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_hp_predicted_at ON historical_predictions(predicted_at DESC)`,
      ],
    },
    {
      name: 'ai_learning_ledger',
      ddl: [
        `CREATE TABLE IF NOT EXISTS ai_learning_ledger (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          lesson TEXT NOT NULL,
          source VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_all_symbol ON ai_learning_ledger(symbol)`,
      ],
    },
    {
      name: 'deep_analysis_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS deep_analysis_logs (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          analysis_type VARCHAR(32),
          payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_dal_symbol ON deep_analysis_logs(symbol)`,
      ],
    },
    {
      name: 'backtest_results',
      ddl: [
        `CREATE TABLE IF NOT EXISTS backtest_results (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          strategy VARCHAR(64),
          params JSONB,
          result JSONB,
          ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_br_symbol ON backtest_results(symbol)`,
      ],
    },
    {
      name: 'portfolio_history',
      ddl: [
        `CREATE TABLE IF NOT EXISTS portfolio_history (
          id SERIAL PRIMARY KEY,
          snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          total_usd NUMERIC(18,2),
          open_positions INTEGER,
          payload JSONB
        )`,
        `CREATE INDEX IF NOT EXISTS idx_ph_snapshot_at ON portfolio_history(snapshot_at DESC)`,
      ],
    },
    {
      name: 'audit_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS audit_logs (
          id SERIAL PRIMARY KEY,
          event VARCHAR(128) NOT NULL,
          level VARCHAR(16) NOT NULL DEFAULT 'info',
          meta JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_al_event ON audit_logs(event)`,
        `CREATE INDEX IF NOT EXISTS idx_al_created_at ON audit_logs(created_at DESC)`,
      ],
    },
    {
      name: 'learning_metrics',
      ddl: [
        `CREATE TABLE IF NOT EXISTS learning_metrics (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32),
          metric_name VARCHAR(64) NOT NULL,
          value NUMERIC(18,6),
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_lm_symbol ON learning_metrics(symbol)`,
      ],
    },
    {
      name: 'learning_reports',
      ddl: [
        `CREATE TABLE IF NOT EXISTS learning_reports (
          id SERIAL PRIMARY KEY,
          report_type VARCHAR(32),
          content TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_lr_created_at ON learning_reports(created_at DESC)`,
      ],
    },
    {
      name: 'simulation_trades',
      ddl: [
        `CREATE TABLE IF NOT EXISTS simulation_trades (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          direction VARCHAR(8),
          entry_price NUMERIC(18,8),
          exit_price NUMERIC(18,8),
          quantity NUMERIC(18,8),
          pnl_usd NUMERIC(18,4),
          pnl_pct NUMERIC(10,4),
          opened_at TIMESTAMPTZ,
          closed_at TIMESTAMPTZ,
          status VARCHAR(16) DEFAULT 'OPEN'
        )`,
        `CREATE INDEX IF NOT EXISTS idx_st_symbol ON simulation_trades(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_st_status ON simulation_trades(status)`,
      ],
    },
    {
      name: 'failed_signals',
      ddl: [
        `CREATE TABLE IF NOT EXISTS failed_signals (
          id SERIAL PRIMARY KEY,
          job_id TEXT NOT NULL,
          job_name VARCHAR(64) NOT NULL,
          queue_name VARCHAR(64) NOT NULL DEFAULT 'quantum-core-queue',
          payload JSONB NOT NULL,
          error_message TEXT,
          attempts_made INTEGER DEFAULT 0,
          failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_failed_signal_job UNIQUE (job_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_fs_job_name ON failed_signals(job_name)`,
        `CREATE INDEX IF NOT EXISTS idx_fs_failed_at ON failed_signals(failed_at DESC)`,
      ],
    },
  ];

  for (const { name, ddl } of steps) {
    try {
      for (const stmt of ddl) {
        await queryRaw(stmt);
      }
      console.log(`[Orchestrator] ✓ Table ready: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Orchestrator] ✗ DDL failed for ${name}: ${msg}`);
      throw new Error(`DB_BOOT_FAILED: table ${name} — ${msg}`);
    }
  }

  const elapsed = Date.now() - t0;
  console.log(`[Orchestrator] ✅ All tables initialized in ${elapsed}ms`);
  writeAudit({ event: 'orchestrator.db_boot_complete', level: 'info', meta: { elapsed, tables: steps.length } });
}

// ─── Expert Definitions ────────────────────────────────────────────────────

export interface ExpertTask {
  name: string;
  description: string;
  run: (ctx: OrchestratorContext) => Promise<ExpertResult>;
}

export interface ExpertResult {
  expert: string;
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0–100
  reasoning: string;
  durationMs: number;
}

export interface OrchestratorContext {
  signal: ValidatedWhaleSignal;
  episodicMemory: string[];
  marketContext?: Record<string, unknown>;
}

// ─── Safe JSON Helpers ─────────────────────────────────────────────────────

const VALID_EXPERT_VERDICTS = ['BULLISH', 'BEARISH', 'NEUTRAL'] as const;

/**
 * Parses the raw LLM text into an ExpertResult payload.
 * Returns a NEUTRAL fallback instead of throwing when the model returns
 * malformed JSON, partial JSON, or wraps the response in markdown fences.
 */
function safeParseExpertJson(raw: string): Pick<ExpertResult, 'verdict' | 'confidence' | 'reasoning'> {
  try {
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const verdict = VALID_EXPERT_VERDICTS.includes(obj.verdict as ExpertResult['verdict'])
      ? (obj.verdict as ExpertResult['verdict'])
      : 'NEUTRAL';
    const rawConf = Number(obj.confidence);
    const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(100, Math.round(rawConf))) : 50;
    const reasoning =
      typeof obj.reasoning === 'string' && obj.reasoning.trim()
        ? obj.reasoning.slice(0, 400)
        : 'No reasoning provided.';
    return { verdict, confidence, reasoning };
  } catch {
    return { verdict: 'NEUTRAL', confidence: 50, reasoning: 'LLM returned malformed JSON — neutral fallback applied.' };
  }
}

/**
 * Parses the CEO Overseer's raw LLM response into a typed decision payload.
 * Falls back to SKIP / 0 confidence on parse failure so the caller's own
 * catch block can still issue a safe default rather than crashing.
 */
function safeParseOverseerJson(raw: string): {
  verdict: 'TRADE' | 'HOLD' | 'SKIP';
  confidence: number;
  reasoning: string;
  keyRisk: string;
} {
  try {
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const validVerdicts = ['TRADE', 'HOLD', 'SKIP'] as const;
    const verdict = validVerdicts.includes(obj.verdict as 'TRADE' | 'HOLD' | 'SKIP')
      ? (obj.verdict as 'TRADE' | 'HOLD' | 'SKIP')
      : 'SKIP';
    const rawConf = Number(obj.confidence);
    const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(100, Math.round(rawConf))) : 0;
    const reasoning =
      typeof obj.reasoning === 'string' && obj.reasoning.trim()
        ? obj.reasoning.slice(0, 500)
        : 'CEO analysis unavailable.';
    const keyRisk =
      typeof obj.keyRisk === 'string' && obj.keyRisk.trim()
        ? obj.keyRisk.slice(0, 200)
        : 'Unknown risk — defaulting to SKIP.';
    return { verdict, confidence, reasoning, keyRisk };
  } catch {
    return {
      verdict: 'SKIP',
      confidence: 0,
      reasoning: 'CEO LLM returned malformed JSON — defaulting to SKIP.',
      keyRisk: 'Parse failure — system defaulted to SKIP for safety.',
    };
  }
}

// ─── The 7 Experts ────────────────────────────────────────────────────────

async function runTechnicianExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const prompt = `You are the Technician Expert.
Symbol: ${ctx.signal.symbol}
Whale anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%
Episodic memory context: ${ctx.episodicMemory.slice(0, 2).join(' | ') || 'none'}

Analyze purely from a technical price-action perspective.
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'groq' });
  return { expert: 'Technician', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

async function runRiskExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const prompt = `You are the Risk Manager Expert.
Symbol: ${ctx.signal.symbol}
Whale anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%

Analyze from a risk/reward and position-sizing perspective.
Consider volatility, liquidity, and downside exposure.
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'gemini' });
  return { expert: 'RiskManager', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

async function runPsychExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const prompt = `You are the Market Psychologist Expert.
Symbol: ${ctx.signal.symbol}
Whale anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%

Analyze market sentiment, fear/greed, and crowd psychology.
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'gemini' });
  return { expert: 'MarketPsychologist', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

async function runMacroExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const prompt = `You are the Macro & Order Book Expert.
Symbol: ${ctx.signal.symbol}
Whale anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%

Analyze macro trends, funding rates, and order book pressure.
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'groq' });
  return { expert: 'MacroOrderBook', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

async function runOnChainExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const prompt = `You are the On-Chain Sleuth Expert.
Symbol: ${ctx.signal.symbol}
Whale anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%

This IS on-chain data. Interpret whale flow anomaly, smart money patterns.
A large delta_pct positive = institutional accumulation. Negative = distribution.
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'anthropic' });
  return { expert: 'OnChainSleuth', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

async function runDeepMemoryExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const memCtx = ctx.episodicMemory.length > 0
    ? ctx.episodicMemory.join('\n')
    : 'No historical precedent found.';
  const prompt = `You are the Deep Memory Expert (RAG-powered).
Symbol: ${ctx.signal.symbol}
Current anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%

Historical precedents from episodic memory:
${memCtx}

Based on past trade outcomes with similar whale patterns, what is your verdict?
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'gemini' });
  return { expert: 'DeepMemory', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

async function runContrarianExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');
  const prompt = `You are the Contrarian Expert — Devil's Advocate.
Symbol: ${ctx.signal.symbol}
Whale anomaly: ${ctx.signal.anomaly_type} | delta_pct: ${ctx.signal.delta_pct}%

Your job: argue the OPPOSITE of what most experts would say.
Identify hidden risks, false breakouts, whale traps, liquidity grabs.
Respond with JSON: {"verdict":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"<1-2 sentences>"}`;
  const raw = await generateLiveText({ prompt, provider: 'groq' });
  return { expert: 'Contrarian', ...safeParseExpertJson(raw), durationMs: Date.now() - t0 };
}

const EXPERT_TASKS: Array<(ctx: OrchestratorContext) => Promise<ExpertResult>> = [
  runTechnicianExpert,
  runRiskExpert,
  runPsychExpert,
  runMacroExpert,
  runOnChainExpert,
  runDeepMemoryExpert,
  runContrarianExpert,
];

const EXPERT_NAMES = [
  'Technician',
  'RiskManager',
  'MarketPsychologist',
  'MacroOrderBook',
  'OnChainSleuth',
  'DeepMemory',
  'Contrarian',
];

// ─── CEO Overseer ─────────────────────────────────────────────────────────

export type CeoVerdict = 'TRADE' | 'HOLD' | 'SKIP';

export interface CeoDecision {
  verdict: CeoVerdict;
  confidence: number;
  reasoning: string;
  keyRisk: string;
  durationMs: number;
}

async function runCeoOverseer(
  signal: ValidatedWhaleSignal,
  expertResults: ExpertResult[]
): Promise<CeoDecision> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');

  const expertSummary = expertResults
    .map((e) => `[${e.expert}] ${e.verdict} (${e.confidence}%) — ${e.reasoning}`)
    .join('\n');

  const bullishCount = expertResults.filter((e) => e.verdict === 'BULLISH').length;
  const bearishCount = expertResults.filter((e) => e.verdict === 'BEARISH').length;
  const avgConfidence = Math.round(
    expertResults.reduce((sum, e) => sum + e.confidence, 0) / expertResults.length
  );

  const prompt = `You are the CEO Overseer — the final decision-maker.
Signal: ${signal.symbol} | ${signal.anomaly_type} | delta_pct=${signal.delta_pct}%

Board vote: ${bullishCount} BULLISH, ${bearishCount} BEARISH, avg confidence ${avgConfidence}%

Expert verdicts:
${expertSummary}

Issue a definitive verdict:
- TRADE: execute now, high confidence, clear edge
- HOLD: wait for better entry or confirmation
- SKIP: insufficient edge, conflicting signals, or risk too high

Respond with JSON: {"verdict":"TRADE"|"HOLD"|"SKIP","confidence":0-100,"reasoning":"<2-3 sentences>","keyRisk":"<1 sentence>"}`;

  let raw: string;
  try {
    raw = await generateLiveText({ prompt, provider: 'anthropic' });
  } catch (anthropicErr) {
    const errMsg = anthropicErr instanceof Error ? anthropicErr.message : String(anthropicErr);
    console.warn(
      `[Orchestrator] CEO Anthropic unavailable — Gemini promoted to Acting CEO: ${errMsg}`
    );
    raw = await generateLiveText({ prompt, provider: 'gemini' });
  }
  const parsed = safeParseOverseerJson(raw);
  return { ...parsed, durationMs: Date.now() - t0 };
}

// ─── NeuroPlasticity: Post-Mortem Lesson ──────────────────────────────────

async function runNeuroPlasticity(
  signal: ValidatedWhaleSignal,
  expertResults: ExpertResult[],
  ceoDecision: CeoDecision,
  executionResult: { success: boolean; details?: string } | null
): Promise<void> {
  const t0 = Date.now();
  try {
    const { generateLiveText } = await import('@/lib/ai-client');
    const prompt = `Generate a concise post-mortem lesson for future reference.
Signal: ${signal.symbol} | ${signal.anomaly_type} | delta_pct=${signal.delta_pct}%
CEO Verdict: ${ceoDecision.verdict} (${ceoDecision.confidence}%)
Execution: ${executionResult ? (executionResult.success ? 'SUCCESS' : `FAILED: ${executionResult.details}`) : 'NOT_EXECUTED'}
Key risk identified: ${ceoDecision.keyRisk}

In 2-3 sentences, what should the system learn from this signal processing cycle?`;
    const lesson = await generateLiveText({ prompt, provider: 'groq' });

    const { storePostMortem } = await import('@/lib/vector-db');
    await storePostMortem({
      symbol: signal.symbol,
      predictionId: `whale:${signal.symbol}:${signal.timestamp}`,
      direction: ceoDecision.verdict === 'TRADE'
        ? (expertResults.filter((e) => e.verdict === 'BULLISH').length >= 4 ? 'Bullish' : 'Bearish')
        : 'Neutral',
      finalConfidence: ceoDecision.confidence,
      outcome: ceoDecision.verdict,
      whyWinLose: lesson.trim(),
      agentVerdict: expertResults.map((e) => `${e.expert}:${e.verdict}`).join(','),
      masterInsight: ceoDecision.reasoning,
      reasoningPath: `whale_signal → 7_experts → ceo_overseer → ${ceoDecision.verdict}`,
    });

    await queryRaw(
      `INSERT INTO agent_insights
        (symbol, insight, master_insight, reasoning_path, why_win_lose, agent_verdict, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        signal.symbol,
        lesson.trim(),
        ceoDecision.reasoning,
        `whale → 7experts → CEO(${ceoDecision.verdict})`,
        lesson.trim(),
        expertResults.map((e) => `${e.expert}:${e.verdict}:${e.confidence}`).join(','),
      ]
    );

    console.log(`[Orchestrator] NeuroPlasticity upserted in ${Date.now() - t0}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Orchestrator] NeuroPlasticity failed (non-fatal):', msg);
  }
}

// ─── Main Pipeline Entry Point ────────────────────────────────────────────

export interface OrchestratorJobResult {
  symbol: string;
  ceoVerdict: CeoVerdict;
  expertCount: number;
  expertsFailed: number;
  confidence: number;
  durationMs: number;
}

/**
 * The God-Class pipeline. Called exclusively by the BullMQ quantum-core-queue worker.
 * Every step emits live telemetry via job.updateProgress() and job.log().
 */
export async function orchestrateWhaleSignal(
  job: Job
): Promise<OrchestratorJobResult> {
  const globalStart = Date.now();

  // ── Step 0: Validate ──────────────────────────────────────────────────────
  await job.updateProgress(5);
  await job.log('STEP_0 | Validating signal...');

  const parsed = WhaleSignalSchema.safeParse(job.data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join('; ');
    await job.log(`VALIDATION_FAILED | ${issues}`);
    console.error(`[Orchestrator] VALIDATION_FAILED — job dropped: ${issues}`);
    writeAudit({
      event: 'orchestrator.validation_failed',
      level: 'warn',
      meta: { jobId: job.id, data: job.data, issues },
    });
    throw new Error(`VALIDATION_FAILED: ${issues}`);
  }

  const signal = parsed.data;
  await job.log(`STEP_0 | ✓ Signal valid: ${signal.symbol} | ${signal.anomaly_type} | Δ${signal.delta_pct}%`);
  await job.updateProgress(10);

  // ── Step 1: DB Boot ───────────────────────────────────────────────────────
  await job.log('STEP_1 | Booting DB tables (if not ready)...');
  await ensureAllTablesExist();
  await job.log('STEP_1 | ✓ All tables verified');
  await job.updateProgress(15);

  // ── Step 2: EpisodicMemory (Pinecone) ─────────────────────────────────────
  await job.log('STEP_2 | Querying EpisodicMemory (Pinecone)...');
  let episodicMemory: string[] = [];
  try {
    const { querySimilarTrades } = await import('@/lib/vector-db');
    const hits = await querySimilarTrades(signal.symbol, 3);
    episodicMemory = hits.map(
      (h) =>
        `[${h.symbol}] ${h.outcome ?? 'unknown'} — ${h.whyWinLose ?? h.masterInsight ?? 'no detail'} (score=${h.score?.toFixed(3) ?? '?'})`
    );
    await job.log(`STEP_2 | ✓ Retrieved ${episodicMemory.length} episodic memories`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await job.log(`STEP_2 | ⚠ Pinecone unavailable (non-fatal): ${msg}`);
    console.warn('[Orchestrator] Pinecone query failed, proceeding without memory:', msg);
  }
  await job.updateProgress(25);

  // ── Step 3: Fan-out — 7 Experts via Promise.allSettled ───────────────────
  await job.log(`STEP_3 | Dispatching to ${EXPERT_NAMES.join(', ')}...`);

  const ctx: OrchestratorContext = { signal, episodicMemory };
  const expertPromises = EXPERT_TASKS.map((fn) => fn(ctx));
  const settledResults = await Promise.allSettled(expertPromises);

  await job.updateProgress(60);

  // ── Step 4: Fault Tolerance — collect only successful results ─────────────
  const expertResults: ExpertResult[] = [];
  let expertsFailed = 0;

  for (let i = 0; i < settledResults.length; i++) {
    const result = settledResults[i];
    const name = EXPERT_NAMES[i];
    if (result.status === 'fulfilled') {
      expertResults.push(result.value);
      await job.log(`STEP_4 | ✓ ${name}: ${result.value.verdict} (${result.value.confidence}%)`);
    } else {
      expertsFailed++;
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      await job.log(`STEP_4 | ✗ ${name} FAILED (skipped): ${errMsg}`);
      console.warn(`[Orchestrator] Expert ${name} failed, skipping:`, errMsg);
    }
  }

  if (expertResults.length === 0) {
    await job.log('STEP_4 | ABORT: All 7 experts failed — no basis for decision');
    throw new Error('PIPELINE_ABORT: All experts failed simultaneously');
  }

  await job.log(
    `STEP_4 | Board complete: ${expertResults.length}/${EXPERT_NAMES.length} experts succeeded`
  );
  await job.updateProgress(70);

  // ── Step 5: Fan-in — CEO Overseer ─────────────────────────────────────────
  await job.log('STEP_5 | CEO Overseer synthesizing verdict...');
  let ceoDecision: CeoDecision;
  try {
    ceoDecision = await runCeoOverseer(signal, expertResults);
    await job.log(
      `STEP_5 | ✓ CEO Verdict: ${ceoDecision.verdict} (${ceoDecision.confidence}%) — ${ceoDecision.reasoning}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await job.log(`STEP_5 | CEO FAILED — defaulting to SKIP: ${msg}`);
    console.error('[Orchestrator] CEO Overseer failed, defaulting to SKIP:', msg);
    ceoDecision = {
      verdict: 'SKIP',
      confidence: 0,
      reasoning: `CEO call failed: ${msg}`,
      keyRisk: 'System error — CEO unavailable',
      durationMs: 0,
    };
  }
  await job.updateProgress(80);

  // ── Step 6: Execution (TRADE only) ────────────────────────────────────────
  let executionResult: { success: boolean; details?: string } | null = null;

  if (ceoDecision.verdict === 'TRADE') {
    await job.log('STEP_6 | CEO issued TRADE — handing to Trading Robot...');
    try {
      const { executeAutonomousConsensusSignal } = await import('@/lib/trading/execution-engine');
      const majorityBullish =
        expertResults.filter((e) => e.verdict === 'BULLISH').length >
        expertResults.filter((e) => e.verdict === 'BEARISH').length;

      await executeAutonomousConsensusSignal({
        predictionId: `whale:${signal.symbol}:${signal.timestamp}`,
        symbol: signal.symbol,
        predictedDirection: majorityBullish ? 'Bullish' : 'Bearish',
        finalConfidence: ceoDecision.confidence,
        consensusApproved: true,
        consensusReasoning: {
          overseerSummary: ceoDecision.reasoning,
          expertReasoning: expertResults.map((e) => e.reasoning).join(' | '),
        },
        marketVolatility: Math.abs(signal.delta_pct),
      });
      executionResult = { success: true };
      await job.log('STEP_6 | ✓ Trading Robot executed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      executionResult = { success: false, details: msg };
      await job.log(`STEP_6 | Trading Robot FAILED (position not opened): ${msg}`);
      console.error('[Orchestrator] Trading Robot failed:', msg);
    }
  } else {
    await job.log(`STEP_6 | CEO verdict is ${ceoDecision.verdict} — no trade execution`);
  }
  await job.updateProgress(90);

  // ── Step 7: NeuroPlasticity ────────────────────────────────────────────────
  await job.log('STEP_7 | Writing post-mortem lesson to NeuroPlasticity (Pinecone + Postgres)...');
  await runNeuroPlasticity(signal, expertResults, ceoDecision, executionResult);
  await job.log('STEP_7 | ✓ NeuroPlasticity complete');

  const totalDuration = Date.now() - globalStart;
  await job.updateProgress(100);
  await job.log(
    `PIPELINE_COMPLETE | ${signal.symbol} | CEO=${ceoDecision.verdict} | ` +
    `experts=${expertResults.length}/${EXPERT_NAMES.length} | ` +
    `duration=${totalDuration}ms`
  );

  writeAudit({
    event: 'orchestrator.pipeline_complete',
    level: 'info',
    meta: {
      symbol: signal.symbol,
      ceoVerdict: ceoDecision.verdict,
      confidence: ceoDecision.confidence,
      expertSucceeded: expertResults.length,
      expertsFailed,
      durationMs: totalDuration,
    },
  });

  console.log(
    `[Orchestrator] ✅ Pipeline complete — ${signal.symbol} | ` +
    `CEO=${ceoDecision.verdict}(${ceoDecision.confidence}%) | ` +
    `${expertResults.length}/${EXPERT_NAMES.length} experts | ${totalDuration}ms`
  );

  return {
    symbol: signal.symbol,
    ceoVerdict: ceoDecision.verdict,
    expertCount: expertResults.length,
    expertsFailed,
    confidence: ceoDecision.confidence,
    durationMs: totalDuration,
  };
}
