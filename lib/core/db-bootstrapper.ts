/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              QUANTUM DB BOOTSTRAPPER — CENTRAL DDL              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Single source of truth for ALL CREATE TABLE statements.        ║
 * ║  Called ONCE from instrumentation.ts register() at server boot, ║
 * ║  long before any API route or BullMQ worker touches the DB.     ║
 * ║                                                                  ║
 * ║  Rules:                                                          ║
 * ║  · All DDL is sequential (strict await, no Promise.all)         ║
 * ║  · Uses queryRaw to bypass the sql() schema-init wrapper        ║
 * ║  · Idempotent: every statement uses IF NOT EXISTS               ║
 * ║  · Module-level promise cache prevents duplicate runs           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { queryRaw } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Run all CREATE TABLE DDL sequentially — exactly once per process.
 * Subsequent calls return the cached promise immediately.
 */
export function runDbBootstrapper(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = _executeAllDDL().catch((err) => {
      bootstrapPromise = null; // allow retry on failure
      throw err;
    });
  }
  return bootstrapPromise;
}

async function _executeAllDDL(): Promise<void> {
  const dbUrl = APP_CONFIG.postgresUrl?.trim();
  if (!dbUrl) {
    console.log('[DB Bootstrapper] No DATABASE_URL configured — DDL boot skipped.');
    return;
  }

  console.log('[DB Bootstrapper] ⚡ Sequential DDL boot starting...');
  const t0 = Date.now();

  const steps: Array<{ name: string; ddl: string[] }> = [
    // ── Core: prediction_records ─────────────────────────────────────────────
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

    // ── Core: settings (KV store for AppSettings) ────────────────────────────
    {
      name: 'settings',
      ddl: [
        `CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS settings_key_key ON settings(key)`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      ],
    },

    // ── Core: telegram_subscribers ───────────────────────────────────────────
    {
      name: 'telegram_subscribers',
      ddl: [
        `CREATE TABLE IF NOT EXISTS telegram_subscribers (
          id SERIAL PRIMARY KEY,
          chat_id TEXT NOT NULL UNIQUE,
          username TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          role TEXT NOT NULL DEFAULT 'subscriber',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_is_active ON telegram_subscribers(is_active)`,
        `CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_chat_id ON telegram_subscribers(chat_id)`,
        `ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS username TEXT`,
        `ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`,
        `ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'subscriber'`,
        `ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE telegram_subscribers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`,
      ],
    },

    // ── system_settings (singleton id=1: scanner on/off, timestamps) ─────────
    {
      name: 'system_settings',
      ddl: [
        `CREATE TABLE IF NOT EXISTS system_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          scanner_is_active BOOLEAN NOT NULL DEFAULT true,
          last_scan_timestamp BIGINT,
          last_pinecone_upsert_at TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `INSERT INTO system_settings (id, scanner_is_active)
          VALUES (1, true)
          ON CONFLICT (id) DO NOTHING`,
        `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_pinecone_upsert_at TEXT`,
      ],
    },

    // ── expert_weights (singleton id=1: MoE agent weights) ───────────────────
    {
      name: 'expert_weights',
      ddl: [
        `CREATE TABLE IF NOT EXISTS expert_weights (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data_expert_weight NUMERIC(10,6) NOT NULL DEFAULT 1.0,
          news_expert_weight NUMERIC(10,6) NOT NULL DEFAULT 1.0,
          macro_expert_weight NUMERIC(10,6) NOT NULL DEFAULT 1.0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_reason TEXT
        )`,
        `INSERT INTO expert_weights (id, data_expert_weight, news_expert_weight, macro_expert_weight, updated_at, updated_reason)
          VALUES (1, 1.0, 1.0, 1.0, NOW(), 'Initial defaults')
          ON CONFLICT (id) DO NOTHING`,
      ],
    },

    // ── prediction_weights (singleton id=1: Volume/RSI/Sentiment weights) ────
    {
      name: 'prediction_weights',
      ddl: [
        `CREATE TABLE IF NOT EXISTS prediction_weights (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          volume_weight NUMERIC(10,6) NOT NULL DEFAULT 0.4,
          rsi_weight NUMERIC(10,6) NOT NULL DEFAULT 0.3,
          sentiment_weight NUMERIC(10,6) NOT NULL DEFAULT 0.3,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reason TEXT
        )`,
        `INSERT INTO prediction_weights (id, volume_weight, rsi_weight, sentiment_weight, updated_at, reason)
          VALUES (1, 0.4, 0.3, 0.3, NOW(), 'Initial default')
          ON CONFLICT (id) DO NOTHING`,
      ],
    },

    // ── system_configs (singleton id=1: mirrors prediction_weights) ──────────
    {
      name: 'system_configs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS system_configs (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          w_vol NUMERIC(10,6) NOT NULL DEFAULT 0.4,
          w_rsi NUMERIC(10,6) NOT NULL DEFAULT 0.3,
          w_sent NUMERIC(10,6) NOT NULL DEFAULT 0.3,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reason TEXT,
          ai_threshold_override INTEGER
        )`,
        `INSERT INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason)
          VALUES (1, 0.4, 0.3, 0.3, NOW(), 'Initial defaults')
          ON CONFLICT (id) DO NOTHING`,
        `ALTER TABLE system_configs ADD COLUMN IF NOT EXISTS ai_threshold_override INTEGER`,
      ],
    },

    // ── weight_change_log ─────────────────────────────────────────────────────
    {
      name: 'weight_change_log',
      ddl: [
        `CREATE TABLE IF NOT EXISTS weight_change_log (
          id SERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reason_he TEXT NOT NULL,
          volume_weight NUMERIC(10,6) NOT NULL,
          rsi_weight NUMERIC(10,6) NOT NULL,
          sentiment_weight NUMERIC(10,6) NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_weight_change_log_created_at ON weight_change_log(created_at)`,
      ],
    },

    // ── accuracy_snapshots ────────────────────────────────────────────────────
    {
      name: 'accuracy_snapshots',
      ddl: [
        `CREATE TABLE IF NOT EXISTS accuracy_snapshots (
          id SERIAL PRIMARY KEY,
          snapshot_date VARCHAR(10) NOT NULL UNIQUE,
          success_rate_pct NUMERIC(10,4) NOT NULL,
          volume_weight NUMERIC(10,6) NOT NULL,
          rsi_weight NUMERIC(10,6) NOT NULL,
          sentiment_weight NUMERIC(10,6) NOT NULL
        )`,
      ],
    },

    // ── virtual_portfolio (paper trading open/closed positions) ──────────────
    {
      name: 'virtual_portfolio',
      ddl: [
        `CREATE TABLE IF NOT EXISTS virtual_portfolio (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          entry_price NUMERIC(24,8) NOT NULL,
          amount_usd NUMERIC(24,8) NOT NULL,
          entry_date VARCHAR(32) NOT NULL,
          status VARCHAR(16) NOT NULL CHECK (status IN ('open', 'closed')),
          target_profit_pct NUMERIC(10,4) NOT NULL DEFAULT 2,
          stop_loss_pct NUMERIC(10,4) NOT NULL DEFAULT -1.5,
          closed_at TIMESTAMPTZ,
          exit_price NUMERIC(24,8),
          pnl_pct NUMERIC(12,6),
          close_reason VARCHAR(20),
          source VARCHAR(16) DEFAULT 'manual',
          entry_fee_usd NUMERIC(24,8),
          exit_fee_usd NUMERIC(24,8),
          pnl_net_usd NUMERIC(24,8),
          exec_state JSONB DEFAULT '{}'::jsonb
        )`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_status ON virtual_portfolio(status)`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_entry_date ON virtual_portfolio(entry_date)`,
        // Backward compat: add columns that may be missing on existing production tables
        `ALTER TABLE virtual_portfolio ADD COLUMN IF NOT EXISTS close_reason VARCHAR(20)`,
        `ALTER TABLE virtual_portfolio ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'manual'`,
        `ALTER TABLE virtual_portfolio ADD COLUMN IF NOT EXISTS entry_fee_usd NUMERIC(24,8)`,
        `ALTER TABLE virtual_portfolio ADD COLUMN IF NOT EXISTS exit_fee_usd NUMERIC(24,8)`,
        `ALTER TABLE virtual_portfolio ADD COLUMN IF NOT EXISTS pnl_net_usd NUMERIC(24,8)`,
        `ALTER TABLE virtual_portfolio ADD COLUMN IF NOT EXISTS exec_state JSONB DEFAULT '{}'::jsonb`,
      ],
    },

    // ── execution_pipeline_claims (idempotency guard for TWAP/trade open) ────
    {
      name: 'execution_pipeline_claims',
      ddl: [
        `CREATE TABLE IF NOT EXISTS execution_pipeline_claims (
          event_id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_exec_claims_created ON execution_pipeline_claims(created_at)`,
      ],
    },

    // ── virtual_trades_history (execution audit log) ──────────────────────────
    {
      name: 'virtual_trades_history',
      ddl: [
        `CREATE TABLE IF NOT EXISTS virtual_trades_history (
          id SERIAL PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          prediction_id TEXT,
          symbol TEXT NOT NULL,
          signal_side VARCHAR(8) NOT NULL CHECK (signal_side IN ('BUY', 'SELL')),
          confidence NUMERIC(10,4) NOT NULL,
          mode VARCHAR(8) NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
          executed BOOLEAN NOT NULL DEFAULT FALSE,
          execution_status VARCHAR(16) NOT NULL CHECK (execution_status IN ('executed', 'blocked', 'skipped', 'failed')),
          reason TEXT,
          overseer_summary TEXT,
          overseer_reasoning_path TEXT,
          expert_breakdown_json JSONB,
          execution_price NUMERIC(24,8),
          amount_usd NUMERIC(24,8),
          pnl_net_usd NUMERIC(24,8),
          virtual_trade_id INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_trades_history_created_at ON virtual_trades_history(created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_trades_history_symbol ON virtual_trades_history(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_virtual_trades_history_prediction_id ON virtual_trades_history(prediction_id)`,
        // Backward compat
        `ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS overseer_summary TEXT`,
        `ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS overseer_reasoning_path TEXT`,
        `ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS expert_breakdown_json JSONB`,
        `ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS pnl_net_usd NUMERIC(24,8)`,
      ],
    },

    // ── scanner_alert_log ─────────────────────────────────────────────────────
    {
      name: 'scanner_alert_log',
      ddl: [
        `CREATE TABLE IF NOT EXISTS scanner_alert_log (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          prediction_id VARCHAR(255) NOT NULL,
          probability DOUBLE PRECISION NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_scanner_alert_log_alerted_at ON scanner_alert_log(alerted_at)`,
        `CREATE INDEX IF NOT EXISTS idx_scanner_alert_log_symbol ON scanner_alert_log(symbol)`,
      ],
    },

    // ── agent_insights (post-mortem / MoE expert scores) ─────────────────────
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
        // Backward compat
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS tech_score INTEGER`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS risk_score INTEGER`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS psych_score INTEGER`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS macro_score INTEGER`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS onchain_score INTEGER`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS deep_memory_score INTEGER`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS master_insight TEXT`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS reasoning_path TEXT`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS why_win_lose TEXT`,
        `ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS agent_verdict TEXT`,
      ],
    },

    // ── board_meeting_logs ────────────────────────────────────────────────────
    {
      name: 'board_meeting_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS board_meeting_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('morning', 'evening', 'whale')),
          the_7_expert_verdicts JSONB NOT NULL,
          overseer_final_action_plan TEXT NOT NULL,
          market_context JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_timestamp ON board_meeting_logs(timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_trigger_type ON board_meeting_logs(trigger_type)`,
      ],
    },

    // ── simulation_trades (UI paper trading) ──────────────────────────────────
    {
      name: 'simulation_trades',
      ddl: [
        `CREATE TABLE IF NOT EXISTS simulation_trades (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          price DOUBLE PRECISION NOT NULL,
          amount_usd DOUBLE PRECISION NOT NULL,
          amount_asset DOUBLE PRECISION NOT NULL,
          fee_usd DOUBLE PRECISION NOT NULL,
          timestamp BIGINT NOT NULL,
          date_label TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_simulation_trades_timestamp ON simulation_trades(timestamp)`,
      ],
    },

    // ── historical_predictions (evaluation / backtest feedback loop) ──────────
    {
      name: 'historical_predictions',
      ddl: [
        `CREATE TABLE IF NOT EXISTS historical_predictions (
          id SERIAL PRIMARY KEY,
          prediction_id VARCHAR(255) NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          prediction_date VARCHAR(32) NOT NULL,
          predicted_direction VARCHAR(16) NOT NULL,
          entry_price NUMERIC(24,8) NOT NULL,
          actual_price NUMERIC(24,8) NOT NULL,
          price_diff_pct NUMERIC(12,6) NOT NULL,
          absolute_error_pct NUMERIC(12,6) NOT NULL,
          target_percentage NUMERIC(12,6),
          probability NUMERIC(8,4),
          outcome_label VARCHAR(64) NOT NULL,
          requires_deep_analysis BOOLEAN NOT NULL,
          evaluated_at TIMESTAMPTZ NOT NULL,
          sentiment_score NUMERIC(10,4),
          market_narrative TEXT,
          bottom_line_he TEXT,
          risk_level_he TEXT,
          forecast_24h_he TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_historical_predictions_symbol ON historical_predictions(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_historical_predictions_evaluated_at ON historical_predictions(evaluated_at)`,
      ],
    },

    // ── ai_learning_ledger (long-term memory, error margins) ──────────────────
    {
      name: 'ai_learning_ledger',
      ddl: [
        `CREATE TABLE IF NOT EXISTS ai_learning_ledger (
          id SERIAL PRIMARY KEY,
          prediction_id VARCHAR(255) NOT NULL UNIQUE,
          timestamp TIMESTAMPTZ NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          predicted_price DECIMAL(24,8) NOT NULL,
          actual_price DECIMAL(24,8) NOT NULL,
          error_margin_pct DECIMAL(12,6) NOT NULL,
          ai_conclusion TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_ai_learning_ledger_timestamp ON ai_learning_ledger(timestamp)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_learning_ledger_prediction_id ON ai_learning_ledger(prediction_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ai_learning_ledger_symbol ON ai_learning_ledger(symbol)`,
      ],
    },

    // ── backtest_logs ─────────────────────────────────────────────────────────
    {
      name: 'backtest_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS backtest_logs (
          id SERIAL PRIMARY KEY,
          prediction_id VARCHAR(255) NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          prediction_date VARCHAR(32) NOT NULL,
          predicted_direction VARCHAR(16) NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          current_price DOUBLE PRECISION NOT NULL,
          price_diff_pct DOUBLE PRECISION NOT NULL,
          absolute_error_pct DOUBLE PRECISION NOT NULL,
          outcome_label VARCHAR(64) NOT NULL,
          requires_deep_analysis BOOLEAN NOT NULL,
          evaluated_at TIMESTAMPTZ NOT NULL,
          sentiment_score DOUBLE PRECISION,
          market_narrative TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_backtest_logs_evaluated_at ON backtest_logs(evaluated_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_backtest_logs_symbol ON backtest_logs(symbol)`,
      ],
    },

    // ── deep_analysis_logs ────────────────────────────────────────────────────
    {
      name: 'deep_analysis_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS deep_analysis_logs (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          news_sentiment TEXT NOT NULL,
          news_narrative_he TEXT NOT NULL,
          onchain_summary_he TEXT NOT NULL,
          onchain_signal TEXT NOT NULL,
          technical_score DOUBLE PRECISION NOT NULL,
          weighted_verdict_pct DOUBLE PRECISION NOT NULL,
          verdict_he TEXT NOT NULL,
          recommendation_he TEXT NOT NULL,
          prediction_id VARCHAR(255)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_deep_analysis_logs_symbol ON deep_analysis_logs(symbol)`,
        `CREATE INDEX IF NOT EXISTS idx_deep_analysis_logs_created_at ON deep_analysis_logs(created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_deep_analysis_logs_prediction_id ON deep_analysis_logs(prediction_id)`,
      ],
    },

    // ── portfolio_history (daily equity snapshots) ────────────────────────────
    {
      name: 'portfolio_history',
      ddl: [
        `CREATE TABLE IF NOT EXISTS portfolio_history (
          id SERIAL PRIMARY KEY,
          snapshot_date DATE NOT NULL UNIQUE,
          equity_value NUMERIC(24,8) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_portfolio_history_snapshot_date ON portfolio_history(snapshot_date DESC)`,
      ],
    },

    // ── audit_logs (security forensics) ──────────────────────────────────────
    {
      name: 'audit_logs',
      ddl: [
        `CREATE TABLE IF NOT EXISTS audit_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          action_type VARCHAR(128) NOT NULL,
          actor_ip VARCHAR(64),
          user_agent TEXT,
          payload_diff JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type)`,
      ],
    },

    // ── learning_reports (Lessons Learned for Retrospective Engine) ───────────
    {
      name: 'learning_reports',
      ddl: [
        `CREATE TABLE IF NOT EXISTS learning_reports (
          id SERIAL PRIMARY KEY,
          success_summary_he TEXT NOT NULL,
          key_lesson_he TEXT NOT NULL,
          action_taken_he TEXT NOT NULL,
          accuracy_pct NUMERIC(10,4) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_learning_reports_created_at ON learning_reports(created_at)`,
      ],
    },

    // ── daily_accuracy_stats (win rate / prediction accuracy tracking) ────────
    {
      name: 'daily_accuracy_stats',
      ddl: [
        `CREATE TABLE IF NOT EXISTS daily_accuracy_stats (
          stat_date DATE PRIMARY KEY,
          win_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
          prediction_accuracy_score NUMERIC(10,4) NOT NULL DEFAULT 0,
          learning_delta NUMERIC(10,4) NOT NULL DEFAULT 0,
          false_positives_avoided INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_daily_accuracy_stats_stat_date ON daily_accuracy_stats(stat_date DESC)`,
      ],
    },

    // ── trade_executions (Execution Learning module) ──────────────────────────
    {
      name: 'trade_executions',
      ddl: [
        `CREATE TABLE IF NOT EXISTS trade_executions (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          alpha_signal_id TEXT,
          type TEXT NOT NULL CHECK (type IN ('PAPER', 'LIVE')),
          side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
          amount NUMERIC(24,8) NOT NULL,
          entry_price NUMERIC(24,8) NOT NULL,
          exit_price NUMERIC(24,8),
          pnl NUMERIC(24,8),
          status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'FAILED')),
          executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ
        )`,
        `CREATE INDEX IF NOT EXISTS idx_trade_exec_symbol_executed_at ON trade_executions(symbol, executed_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_trade_exec_status_executed_at ON trade_executions(status, executed_at DESC)`,
      ],
    },

    // ── learned_insights (FK: trade_executions) ───────────────────────────────
    {
      name: 'learned_insights',
      ddl: [
        `CREATE TABLE IF NOT EXISTS learned_insights (
          id TEXT PRIMARY KEY,
          trade_id TEXT NOT NULL REFERENCES trade_executions(id) ON DELETE CASCADE,
          failure_reason TEXT NOT NULL,
          academy_reference TEXT,
          adjustment_applied BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_learned_insights_trade_created ON learned_insights(trade_id, created_at DESC)`,
      ],
    },

    // ── failed_signals (BullMQ dead-letter store) ─────────────────────────────
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
    for (const stmt of ddl) {
      await queryRaw(stmt);
    }
    console.log(`[DB Bootstrapper] ✓ ${name}`);
  }

  const elapsed = Date.now() - t0;
  console.log(`[DB Bootstrapper] ✅ All ${steps.length} tables bootstrapped in ${elapsed}ms`);
}
