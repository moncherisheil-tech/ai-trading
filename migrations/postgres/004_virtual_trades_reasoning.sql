-- Persist explainable trade rationale for paper/live execution records.
ALTER TABLE virtual_trades_history
  ADD COLUMN IF NOT EXISTS overseer_summary TEXT;

ALTER TABLE virtual_trades_history
  ADD COLUMN IF NOT EXISTS overseer_reasoning_path TEXT;

ALTER TABLE virtual_trades_history
  ADD COLUMN IF NOT EXISTS expert_breakdown_json JSONB;
