import { sql } from '@/lib/db/sql';
import { areTablesReady } from '@/lib/db/init-guard';
import { APP_CONFIG } from '@/lib/config';
import type { ExpertOutput } from '@/lib/workers/board-of-experts';

type TriggerType = 'morning' | 'evening';

export interface BoardMeetingLogInput {
  trigger_type: TriggerType;
  the_7_expert_verdicts: Record<string, ExpertOutput>;
  overseer_final_action_plan: string;
  market_context: {
    fearGreed: {
      value: number;
      valueClassification: string;
      fetchedAt: string;
    };
    topHeadlines: string[];
    expert4LiquiditySignals?: unknown;
  };
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  // Short-circuit: Orchestrator already booted all tables sequentially.
  if (areTablesReady()) return true;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS board_meeting_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('morning', 'evening')),
        the_7_expert_verdicts JSONB NOT NULL,
        overseer_final_action_plan TEXT NOT NULL,
        market_context JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_timestamp ON board_meeting_logs(timestamp DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_board_meeting_logs_trigger_type ON board_meeting_logs(trigger_type)`;
    return true;
  } catch (err) {
    console.error('board_meeting_logs ensureTable failed:', err);
    return false;
  }
}

export async function recordBoardMeetingLog(input: BoardMeetingLogInput): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const ok = await ensureTable();
    if (!ok) return 0;
    const { rows } = await sql`
      INSERT INTO board_meeting_logs (
        timestamp,
        trigger_type,
        the_7_expert_verdicts,
        overseer_final_action_plan,
        market_context
      )
      VALUES (
        ${new Date().toISOString()},
        ${input.trigger_type},
        ${JSON.stringify(input.the_7_expert_verdicts)},
        ${input.overseer_final_action_plan},
        ${JSON.stringify(input.market_context)}
      )
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('recordBoardMeetingLog failed:', err);
    return 0;
  }
}
