/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   QUANTUM OMEGA GOD-CLASS ORCHESTRATOR  ·  Omega Sentinel v2    ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Single source of truth for ALL AI calls and ALL DB operations. ║
 * ║  No component, route, or worker may bypass this module.         ║
 * ║                                                                  ║
 * ║  PIPELINE (Omega Sentinel — MoE + MTF + News):                  ║
 * ║   0. Zod validation           → drop invalid / mock signals     ║
 * ║   1. DB Boot                  → ensureAllTablesExist() once     ║
 * ║   2. MTF Confluence           → H1/D1/W1/M1 trend gate         ║
 * ║   3. News Sentinel            → scenario A/B/C classification   ║
 * ║   4. EpisodicMemory           → Pinecone context fetch          ║
 * ║   5. Fan-out (Board)          → 8 experts (incl. NewsSentinel)  ║
 * ║   6. Fault Tolerance          → failed experts skipped          ║
 * ║   7. Fan-in (CEO)             → Overseer synthesizes verdict    ║
 * ║   8. Execution                → Trading Robot on TRADE only     ║
 * ║   9. NeuroPlasticity          → post-mortem → Pinecone + PG     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { z } from 'zod';
import type { Job } from 'bullmq';
import { runDbBootstrapper } from '@/lib/core/db-bootstrapper';
import { queryRaw } from '@/lib/db/sql';
import { writeAudit } from '@/lib/audit';
import type { MTFConfluenceResult } from '@/lib/trading/mtf-fetcher';
import type { NewsSentinelResult } from '@/lib/agents/news-sentinel';

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
  /** Multi-Timeframe Confluence result — populated before expert fan-out */
  mtfConfluence?: MTFConfluenceResult;
  /** News Sentinel result — populated before expert fan-out */
  newsSentinel?: NewsSentinelResult;
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

/**
 * NewsSentinel Expert (8th expert) — uses the pre-fetched news scenario result
 * from OrchestratorContext to avoid double-fetching headlines.
 * Falls back to a fresh fetch when context is unavailable.
 */
async function runNewsSentinelExpert(ctx: OrchestratorContext): Promise<ExpertResult> {
  const t0 = Date.now();

  let sentinelResult: NewsSentinelResult;

  if (ctx.newsSentinel) {
    sentinelResult = ctx.newsSentinel;
  } else {
    const { runNewsSentinel } = await import('@/lib/agents/news-sentinel');
    sentinelResult = await runNewsSentinel(ctx.signal.symbol, ctx.signal.delta_pct);
  }

  const { newsSentinelToVerdict } = await import('@/lib/agents/news-sentinel');
  const verdict = newsSentinelToVerdict(sentinelResult);

  return {
    expert: 'NewsSentinel',
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    reasoning: verdict.reasoning,
    durationMs: Date.now() - t0,
  };
}

const EXPERT_TASKS: Array<(ctx: OrchestratorContext) => Promise<ExpertResult>> = [
  runTechnicianExpert,
  runRiskExpert,
  runPsychExpert,
  runMacroExpert,
  runOnChainExpert,
  runDeepMemoryExpert,
  runContrarianExpert,
  runNewsSentinelExpert,
];

const EXPERT_NAMES = [
  'Technician',
  'RiskManager',
  'MarketPsychologist',
  'MacroOrderBook',
  'OnChainSleuth',
  'DeepMemory',
  'Contrarian',
  'NewsSentinel',
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

// Weight key map: expert name → NeuroPlasticity field name
const EXPERT_WEIGHT_KEYS: Record<string, string> = {
  Technician:         'techWeight',
  RiskManager:        'riskWeight',
  MarketPsychologist: 'psychWeight',
  MacroOrderBook:     'macroWeight',
  OnChainSleuth:      'onchainWeight',
  DeepMemory:         'deepMemoryWeight',
  Contrarian:         'contrarianWeight',
  NewsSentinel:       'newsSentinelWeight',  // Omega Sentinel Phase 3
};

async function runCeoOverseer(
  signal: ValidatedWhaleSignal,
  expertResults: ExpertResult[],
  mtfConfluence?: MTFConfluenceResult,
  newsSentinel?: NewsSentinelResult
): Promise<CeoDecision> {
  const t0 = Date.now();
  const { generateLiveText } = await import('@/lib/ai-client');

  // Load live NeuroPlasticity weights so CEO can weight each expert by historical accuracy
  let weights: Record<string, number> = {};
  try {
    const { fetchCurrentNeuroPlasticity } = await import('@/lib/trading/reinforcement-learning');
    const np = await fetchCurrentNeuroPlasticity();
    weights = np as unknown as Record<string, number>;
  } catch {
    // Non-fatal: CEO proceeds with equal weights if NeuroPlasticity is unavailable
  }

  const getWeight = (expertName: string): number => {
    const key = EXPERT_WEIGHT_KEYS[expertName];
    const w = key ? Number(weights[key]) : NaN;
    return Number.isFinite(w) && w > 0 ? w : 1.0;
  };

  // Weighted confidence: experts with higher historical accuracy carry more signal
  const totalWeight = expertResults.reduce((sum, e) => sum + getWeight(e.expert), 0);
  const weightedAvgConfidence = totalWeight > 0
    ? Math.round(expertResults.reduce((sum, e) => sum + e.confidence * getWeight(e.expert), 0) / totalWeight)
    : Math.round(expertResults.reduce((sum, e) => sum + e.confidence, 0) / expertResults.length);

  const bullishCount = expertResults.filter((e) => e.verdict === 'BULLISH').length;
  const bearishCount = expertResults.filter((e) => e.verdict === 'BEARISH').length;

  const expertSummary = expertResults
    .map((e) => {
      const w = getWeight(e.expert);
      const trust = w >= 1.3 ? '★ HIGH TRUST' : w <= 0.7 ? '⚠ LOW TRUST' : 'NEUTRAL';
      return `[${e.expert} weight=${w.toFixed(2)} ${trust}] ${e.verdict} (${e.confidence}%) — ${e.reasoning}`;
    })
    .join('\n');

  // Build MTF context for CEO
  let mtfSection = '';
  if (mtfConfluence) {
    const { formatMTFSummary } = await import('@/lib/trading/mtf-fetcher');
    mtfSection = `\nMulti-Timeframe Confluence: ${formatMTFSummary(mtfConfluence)}`;
    if (!mtfConfluence.isConfluent) {
      mtfSection += '\n⚠ MTF GATE: Confluence FAILED (< 3/4 TFs aligned). Bias toward SKIP.';
    }
  }

  // Build news context for CEO
  let newsSection = '';
  if (newsSentinel) {
    const scenarioLabel = {
      A_STRONG_BUY: 'Scenario A — Confirmed Catalyst (BULLISH)',
      B_MANIPULATION_WARNING: 'Scenario B — Possible Manipulation (BEARISH WARNING)',
      C_PROTECT_CAPITAL: 'Scenario C — Macro Risk Detected → PROTECT_CAPITAL',
      NEUTRAL: 'Neutral news environment',
    }[newsSentinel.scenario];
    newsSection = `\nNews Sentinel: ${scenarioLabel} | Sentiment=${newsSentinel.sentimentScore.toFixed(2)}`;
    if (newsSentinel.riskMode === 'PROTECT_CAPITAL') {
      newsSection += '\n🚨 NEWS SENTINEL: PROTECT_CAPITAL mode — Tighten SL, reduce position size.';
    }
  }

  const prompt = `You are the CEO Overseer — the final decision-maker.
Signal: ${signal.symbol} | ${signal.anomaly_type} | delta_pct=${signal.delta_pct}%${mtfSection}${newsSection}

Board vote: ${bullishCount} BULLISH, ${bearishCount} BEARISH, weighted confidence ${weightedAvgConfidence}%
(Weights reflect historical accuracy — HIGH TRUST experts have proven track records, LOW TRUST experts have recent mis-calls.)

Expert verdicts with accuracy weights:
${expertSummary}

OMEGA SENTINEL RULES:
- If MTF confluence FAILED (< 3 TFs aligned): default to SKIP unless overwhelming expert consensus
- If News Sentinel = PROTECT_CAPITAL: always SKIP or HOLD, never TRADE
- If News Sentinel = B_MANIPULATION_WARNING: high skepticism required before TRADE
- If News Sentinel = A_STRONG_BUY + MTF confluent: lower the TRADE threshold

Issue a definitive verdict:
- TRADE: execute now, high confidence, clear edge — prioritize HIGH TRUST expert consensus
- HOLD: wait for better entry or confirmation
- SKIP: insufficient edge, conflicting signals, or risk too high — LOW TRUST majority = SKIP

Respond with JSON: {"verdict":"TRADE"|"HOLD"|"SKIP","confidence":0-100,"reasoning":"<2-3 sentences>","keyRisk":"<1 sentence>"}`;

  // Hard override: PROTECT_CAPITAL news mode forces SKIP before any LLM call
  if (newsSentinel?.riskMode === 'PROTECT_CAPITAL') {
    console.log('[Orchestrator] CEO hard-skipped via News Sentinel PROTECT_CAPITAL mode.');
    return {
      verdict: 'SKIP',
      confidence: 95,
      reasoning: `News Sentinel triggered PROTECT_CAPITAL mode: ${newsSentinel.reasoning}`,
      keyRisk: 'Macro/regulatory risk detected — no trade executed.',
      durationMs: Date.now() - t0,
    };
  }

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

  // Post-parse override: if MTF gate failed AND verdict is TRADE → demote to HOLD
  if (mtfConfluence && !mtfConfluence.isConfluent && parsed.verdict === 'TRADE') {
    console.log('[Orchestrator] CEO TRADE demoted to HOLD: MTF confluence gate failed.');
    return {
      ...parsed,
      verdict: 'HOLD',
      reasoning: `${parsed.reasoning} [MTF Gate Override: only ${mtfConfluence.confluenceScore}/4 timeframes confluent — demoted from TRADE to HOLD.]`,
      durationMs: Date.now() - t0,
    };
  }

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

  // ── Step 2: MTF Confluence Gate ───────────────────────────────────────────
  await job.log('STEP_2 | Fetching Multi-Timeframe Confluence (H1/D1/W1/M1)...');
  let mtfConfluence: MTFConfluenceResult | undefined;
  try {
    const { fetchMTFConfluence } = await import('@/lib/trading/mtf-fetcher');
    mtfConfluence = await fetchMTFConfluence(signal.symbol);
    const { formatMTFSummary } = await import('@/lib/trading/mtf-fetcher');
    await job.log(
      `STEP_2 | MTF: ${formatMTFSummary(mtfConfluence)} | Confluent: ${mtfConfluence.isConfluent}`
    );
    if (!mtfConfluence.isConfluent) {
      await job.log(
        `STEP_2 | ⚠ MTF GATE: Confluence score ${mtfConfluence.confluenceScore}/4 — pipeline continues with CEO override protection`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await job.log(`STEP_2 | ⚠ MTF fetch failed (non-fatal): ${msg}`);
    console.warn('[Orchestrator] MTF confluence fetch failed, proceeding without:', msg);
  }
  await job.updateProgress(18);

  // ── Step 2b: News Sentinel ─────────────────────────────────────────────
  await job.log('STEP_2b | News Sentinel — classifying news scenario...');
  let newsSentinel: NewsSentinelResult | undefined;
  try {
    const { runNewsSentinel } = await import('@/lib/agents/news-sentinel');
    newsSentinel = await runNewsSentinel(signal.symbol, signal.delta_pct);
    await job.log(
      `STEP_2b | News Sentinel: scenario=${newsSentinel.scenario} | riskMode=${newsSentinel.riskMode} | latency=${newsSentinel.latencyMs}ms`
    );
    if (newsSentinel.riskMode === 'PROTECT_CAPITAL') {
      await job.log('STEP_2b | 🚨 PROTECT_CAPITAL mode activated — CEO will SKIP this trade');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await job.log(`STEP_2b | ⚠ News Sentinel failed (non-fatal): ${msg}`);
    console.warn('[Orchestrator] News Sentinel failed, proceeding without news context:', msg);
  }
  await job.updateProgress(22);

  // ── Step 3: EpisodicMemory (Pinecone) ─────────────────────────────────────
  await job.log('STEP_3 | Querying EpisodicMemory (Pinecone)...');
  let episodicMemory: string[] = [];
  try {
    const { querySimilarTrades } = await import('@/lib/vector-db');
    const hits = await querySimilarTrades(signal.symbol, 3);
    episodicMemory = hits.map(
      (h) =>
        `[${h.symbol}] ${h.outcome ?? 'unknown'} — ${h.whyWinLose ?? h.masterInsight ?? 'no detail'} (score=${h.score?.toFixed(3) ?? '?'})`
    );
    await job.log(`STEP_3 | ✓ Retrieved ${episodicMemory.length} episodic memories`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await job.log(`STEP_3 | ⚠ Pinecone unavailable (non-fatal): ${msg}`);
    console.warn('[Orchestrator] Pinecone query failed, proceeding without memory:', msg);
  }
  await job.updateProgress(28);

  // ── Step 4: Fan-out — 8 Experts via Promise.allSettled ──────────────────
  await job.log(`STEP_4 | Dispatching to ${EXPERT_NAMES.join(', ')}...`);

  const ctx: OrchestratorContext = { signal, episodicMemory, mtfConfluence, newsSentinel };
  const expertPromises = EXPERT_TASKS.map((fn) => fn(ctx));
  const settledResults = await Promise.allSettled(expertPromises);

  await job.updateProgress(62);

  // ── Step 5: Fault Tolerance — collect only successful results ─────────────
  const expertResults: ExpertResult[] = [];
  let expertsFailed = 0;

  for (let i = 0; i < settledResults.length; i++) {
    const result = settledResults[i];
    const name = EXPERT_NAMES[i];
    if (result.status === 'fulfilled') {
      expertResults.push(result.value);
      await job.log(`STEP_5 | ✓ ${name}: ${result.value.verdict} (${result.value.confidence}%)`);
    } else {
      expertsFailed++;
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      await job.log(`STEP_5 | ✗ ${name} FAILED (skipped): ${errMsg}`);
      console.warn(`[Orchestrator] Expert ${name} failed, skipping:`, errMsg);
    }
  }

  if (expertResults.length === 0) {
    await job.log('STEP_5 | ABORT: All 8 experts failed — no basis for decision');
    throw new Error('PIPELINE_ABORT: All experts failed simultaneously');
  }

  await job.log(
    `STEP_5 | Board complete: ${expertResults.length}/${EXPERT_NAMES.length} experts succeeded`
  );
  await job.updateProgress(72);

  // ── Step 6: Fan-in — CEO Overseer ─────────────────────────────────────────
  await job.log('STEP_6 | CEO Overseer synthesizing verdict...');
  let ceoDecision: CeoDecision;
  try {
    ceoDecision = await runCeoOverseer(signal, expertResults, mtfConfluence, newsSentinel);
    await job.log(
      `STEP_6 | ✓ CEO Verdict: ${ceoDecision.verdict} (${ceoDecision.confidence}%) — ${ceoDecision.reasoning}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await job.log(`STEP_6 | CEO FAILED — defaulting to SKIP: ${msg}`);
    console.error('[Orchestrator] CEO Overseer failed, defaulting to SKIP:', msg);
    ceoDecision = {
      verdict: 'SKIP',
      confidence: 0,
      reasoning: `CEO call failed: ${msg}`,
      keyRisk: 'System error — CEO unavailable',
      durationMs: 0,
    };
  }
  await job.updateProgress(82);

  // ── Step 7: Execution (TRADE only) ────────────────────────────────────────
  let executionResult: { success: boolean; details?: string } | null = null;

  if (ceoDecision.verdict === 'TRADE') {
    await job.log('STEP_7 | CEO issued TRADE — handing to Trading Robot...');
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
      await job.log('STEP_7 | ✓ Trading Robot executed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      executionResult = { success: false, details: msg };
      await job.log(`STEP_7 | Trading Robot FAILED (position not opened): ${msg}`);
      console.error('[Orchestrator] Trading Robot failed:', msg);
    }
  } else {
    await job.log(`STEP_7 | CEO verdict is ${ceoDecision.verdict} — no trade execution`);
  }
  await job.updateProgress(92);

  // ── Step 8: NeuroPlasticity ────────────────────────────────────────────────
  await job.log('STEP_8 | Writing post-mortem lesson to NeuroPlasticity (Pinecone + Postgres)...');
  await runNeuroPlasticity(signal, expertResults, ceoDecision, executionResult);
  await job.log('STEP_8 | ✓ NeuroPlasticity complete');

  const totalDuration = Date.now() - globalStart;
  await job.updateProgress(100);
  await job.log(
    `PIPELINE_COMPLETE | ${signal.symbol} | CEO=${ceoDecision.verdict} | ` +
    `experts=${expertResults.length}/${EXPERT_NAMES.length} | ` +
    `mtf=${mtfConfluence ? `${mtfConfluence.confluenceScore}/4` : 'N/A'} | ` +
    `news=${newsSentinel?.scenario ?? 'N/A'} | ` +
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
      mtfConfluenceScore: mtfConfluence?.confluenceScore ?? null,
      mtfIsConfluent: mtfConfluence?.isConfluent ?? null,
      newsScenario: newsSentinel?.scenario ?? null,
      newsRiskMode: newsSentinel?.riskMode ?? null,
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
