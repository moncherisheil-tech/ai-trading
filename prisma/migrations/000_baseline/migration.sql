-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AlphaTimeframe" AS ENUM ('Hourly', 'Daily', 'Weekly', 'Long');

-- CreateEnum
CREATE TYPE "AlphaDirection" AS ENUM ('Long', 'Short');

-- CreateEnum
CREATE TYPE "AlphaSignalStatus" AS ENUM ('Active', 'Hit', 'Stopped', 'Expired');

-- CreateEnum
CREATE TYPE "TradeExecutionType" AS ENUM ('PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradeExecutionStatus" AS ENUM ('OPEN', 'CLOSED', 'FAILED');

-- CreateTable
CREATE TABLE "AlphaSignalRecord" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" "AlphaTimeframe" NOT NULL,
    "direction" "AlphaDirection" NOT NULL,
    "entryPrice" DECIMAL(24,8) NOT NULL,
    "targetPrice" DECIMAL(24,8) NOT NULL,
    "stopLoss" DECIMAL(24,8) NOT NULL,
    "winProbability" INTEGER NOT NULL,
    "whaleConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "rationaleHebrew" TEXT NOT NULL,
    "status" "AlphaSignalStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlphaSignalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeExecution" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "alphaSignalId" TEXT,
    "type" "TradeExecutionType" NOT NULL,
    "side" "TradeSide" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "entryPrice" DECIMAL(24,8) NOT NULL,
    "exitPrice" DECIMAL(24,8),
    "pnl" DECIMAL(24,8),
    "status" "TradeExecutionStatus" NOT NULL DEFAULT 'OPEN',
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TradeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnedInsight" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "failureReason" TEXT NOT NULL,
    "academyReference" TEXT,
    "adjustmentApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnedInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemNeuroPlasticity" (
    "id" INTEGER NOT NULL,
    "techWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "riskWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "psychWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "macroWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "onchainWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "deepMemoryWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "contrarianWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "ceoConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 75.0,
    "ceoRiskTolerance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "robotSlBufferPct" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "robotTpAggressiveness" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemNeuroPlasticity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodicMemory" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "eventId" TEXT,
    "symbol" TEXT NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "abstractLesson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodicMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accuracy_snapshots" (
    "id" SERIAL NOT NULL,
    "snapshot_date" VARCHAR(10) NOT NULL,
    "success_rate_pct" DECIMAL(10,4) NOT NULL,
    "volume_weight" DECIMAL(10,6) NOT NULL,
    "rsi_weight" DECIMAL(10,6) NOT NULL,
    "sentiment_weight" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "accuracy_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_insights" (
    "id" SERIAL NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "trade_id" INTEGER NOT NULL,
    "entry_conditions" TEXT,
    "outcome" TEXT,
    "insight" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tech_score" INTEGER,
    "risk_score" INTEGER,
    "psych_score" INTEGER,
    "master_insight" TEXT,
    "reasoning_path" TEXT,
    "why_win_lose" TEXT,
    "agent_verdict" TEXT,

    CONSTRAINT "agent_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action_type" VARCHAR(128) NOT NULL,
    "actor_ip" VARCHAR(64),
    "user_agent" TEXT,
    "payload_diff" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expert_weights" (
    "id" INTEGER NOT NULL,
    "data_expert_weight" DECIMAL(10,6) NOT NULL DEFAULT 1.0,
    "news_expert_weight" DECIMAL(10,6) NOT NULL DEFAULT 1.0,
    "macro_expert_weight" DECIMAL(10,6) NOT NULL DEFAULT 1.0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_reason" TEXT,

    CONSTRAINT "expert_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_predictions" (
    "id" SERIAL NOT NULL,
    "prediction_id" VARCHAR(255) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "prediction_date" VARCHAR(32) NOT NULL,
    "predicted_direction" VARCHAR(16) NOT NULL,
    "entry_price" DECIMAL(24,8) NOT NULL,
    "actual_price" DECIMAL(24,8) NOT NULL,
    "price_diff_pct" DECIMAL(12,6) NOT NULL,
    "absolute_error_pct" DECIMAL(12,6) NOT NULL,
    "target_percentage" DECIMAL(12,6),
    "probability" DECIMAL(8,4),
    "outcome_label" VARCHAR(64) NOT NULL,
    "requires_deep_analysis" BOOLEAN NOT NULL,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "sentiment_score" DECIMAL(10,4),
    "market_narrative" TEXT,
    "bottom_line_he" TEXT,
    "risk_level_he" TEXT,
    "forecast_24h_he" TEXT,

    CONSTRAINT "historical_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_records" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "prediction_date" TIMESTAMPTZ(6) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "prediction_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_weights" (
    "id" INTEGER NOT NULL,
    "volume_weight" DECIMAL(10,6) NOT NULL DEFAULT 0.4,
    "rsi_weight" DECIMAL(10,6) NOT NULL DEFAULT 0.3,
    "sentiment_weight" DECIMAL(10,6) NOT NULL DEFAULT 0.3,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "prediction_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_alert_log" (
    "id" SERIAL NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "prediction_id" VARCHAR(255) NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "entry_price" DOUBLE PRECISION NOT NULL,
    "alerted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanner_alert_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_trades" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "amount_asset" DOUBLE PRECISION NOT NULL,
    "fee_usd" DOUBLE PRECISION NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "date_label" TEXT NOT NULL,

    CONSTRAINT "simulation_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" INTEGER NOT NULL,
    "w_vol" DECIMAL(10,6) NOT NULL DEFAULT 0.4,
    "w_rsi" DECIMAL(10,6) NOT NULL DEFAULT 0.3,
    "w_sent" DECIMAL(10,6) NOT NULL DEFAULT 0.3,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "ai_threshold_override" INTEGER,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" INTEGER NOT NULL,
    "scanner_is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_scan_timestamp" BIGINT,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "last_pinecone_upsert_at" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_portfolio" (
    "id" SERIAL NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "entry_price" DECIMAL(24,8) NOT NULL,
    "amount_usd" DECIMAL(24,8) NOT NULL,
    "entry_date" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "target_profit_pct" DECIMAL(10,4) NOT NULL DEFAULT 2,
    "stop_loss_pct" DECIMAL(10,4) NOT NULL DEFAULT -1.5,
    "closed_at" TIMESTAMPTZ(6),
    "exit_price" DECIMAL(24,8),
    "pnl_pct" DECIMAL(12,6),
    "close_reason" VARCHAR(20),
    "source" VARCHAR(16) DEFAULT 'manual',
    "entry_fee_usd" DECIMAL(24,8),
    "exit_fee_usd" DECIMAL(24,8),
    "pnl_net_usd" DECIMAL(24,8),
    "exec_state" JSONB DEFAULT '{}',

    CONSTRAINT "virtual_portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_trades_history" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "prediction_id" TEXT,
    "symbol" TEXT NOT NULL,
    "signal_side" VARCHAR(8) NOT NULL,
    "confidence" DECIMAL(10,4) NOT NULL,
    "mode" VARCHAR(8) NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "execution_status" VARCHAR(16) NOT NULL,
    "reason" TEXT,
    "overseer_summary" TEXT,
    "overseer_reasoning_path" TEXT,
    "expert_breakdown_json" JSONB,
    "execution_price" DECIMAL(24,8),
    "amount_usd" DECIMAL(24,8),
    "pnl_net_usd" DECIMAL(24,8),
    "virtual_trade_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_trades_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_change_log" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_he" TEXT NOT NULL,
    "volume_weight" DECIMAL(10,6) NOT NULL,
    "rsi_weight" DECIMAL(10,6) NOT NULL,
    "sentiment_weight" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "weight_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_meeting_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_type" VARCHAR(16) NOT NULL,
    "the_6_expert_verdicts" JSONB NOT NULL,
    "overseer_final_action_plan" TEXT NOT NULL,
    "market_context" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_meeting_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "telegram_subscribers" (
    "id" SERIAL NOT NULL,
    "chat_id" TEXT NOT NULL,
    "username" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'subscriber',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlphaSignalRecord_status_createdAt_idx" ON "AlphaSignalRecord"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AlphaSignalRecord_symbol_timeframe_status_idx" ON "AlphaSignalRecord"("symbol", "timeframe", "status");

-- CreateIndex
CREATE INDEX "TradeExecution_symbol_executedAt_idx" ON "TradeExecution"("symbol", "executedAt" DESC);

-- CreateIndex
CREATE INDEX "TradeExecution_status_executedAt_idx" ON "TradeExecution"("status", "executedAt" DESC);

-- CreateIndex
CREATE INDEX "LearnedInsight_tradeId_createdAt_idx" ON "LearnedInsight"("tradeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EpisodicMemory_createdAt_idx" ON "EpisodicMemory"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "EpisodicMemory_symbol_idx" ON "EpisodicMemory"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "accuracy_snapshots_snapshot_date_key" ON "accuracy_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "idx_agent_insights_created_at" ON "agent_insights"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_agent_insights_symbol" ON "agent_insights"("symbol");

-- CreateIndex
CREATE INDEX "idx_audit_logs_action_type" ON "audit_logs"("action_type");

-- CreateIndex
CREATE INDEX "idx_audit_logs_timestamp" ON "audit_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_historical_predictions_evaluated_at" ON "historical_predictions"("evaluated_at");

-- CreateIndex
CREATE INDEX "idx_historical_predictions_symbol" ON "historical_predictions"("symbol");

-- CreateIndex
CREATE INDEX "idx_prediction_records_prediction_date" ON "prediction_records"("prediction_date" DESC);

-- CreateIndex
CREATE INDEX "idx_prediction_records_status" ON "prediction_records"("status");

-- CreateIndex
CREATE INDEX "idx_prediction_records_symbol" ON "prediction_records"("symbol");

-- CreateIndex
CREATE INDEX "idx_scanner_alert_log_alerted_at" ON "scanner_alert_log"("alerted_at");

-- CreateIndex
CREATE INDEX "idx_scanner_alert_log_symbol" ON "scanner_alert_log"("symbol");

-- CreateIndex
CREATE INDEX "idx_simulation_trades_timestamp" ON "simulation_trades"("timestamp");

-- CreateIndex
CREATE INDEX "idx_virtual_portfolio_entry_date" ON "virtual_portfolio"("entry_date");

-- CreateIndex
CREATE INDEX "idx_virtual_portfolio_status" ON "virtual_portfolio"("status");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_trades_history_event_id_key" ON "virtual_trades_history"("event_id");

-- CreateIndex
CREATE INDEX "idx_virtual_trades_history_created_at" ON "virtual_trades_history"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_virtual_trades_history_prediction_id" ON "virtual_trades_history"("prediction_id");

-- CreateIndex
CREATE INDEX "idx_virtual_trades_history_symbol" ON "virtual_trades_history"("symbol");

-- CreateIndex
CREATE INDEX "idx_weight_change_log_created_at" ON "weight_change_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_board_meeting_logs_timestamp" ON "board_meeting_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_board_meeting_logs_trigger_type" ON "board_meeting_logs"("trigger_type");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_subscribers_chat_id_key" ON "telegram_subscribers"("chat_id");

-- AddForeignKey
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_alphaSignalId_fkey" FOREIGN KEY ("alphaSignalId") REFERENCES "AlphaSignalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedInsight" ADD CONSTRAINT "LearnedInsight_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "TradeExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodicMemory" ADD CONSTRAINT "EpisodicMemory_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "TradeExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
