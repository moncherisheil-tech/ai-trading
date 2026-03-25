CREATE TABLE IF NOT EXISTS board_meeting_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('morning', 'evening')),
  the_6_expert_verdicts JSONB NOT NULL,
  overseer_final_action_plan TEXT NOT NULL,
  market_context JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_timestamp ON board_meeting_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_trigger_type ON board_meeting_logs(trigger_type);
