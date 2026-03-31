/**
 * Agent insights (תחקיר פוסט-מורטם): learning cycle outcomes from the Smart Agent Trader.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface AgentInsightRow {
  id: number;
  symbol: string;
  trade_id: number;
  entry_conditions: string | null;
  outcome: string | null;
  insight: string;
  created_at: string;
  /** MoE: Technician expert score (0–100). */
  tech_score?: number | null;
  /** MoE: Risk Manager expert score (0–100). */
  risk_score?: number | null;
  /** MoE: Market Psychologist expert score (0–100). */
  psych_score?: number | null;
  /** MoE: Macro & Order Book expert score (0–100). */
  macro_score?: number | null;
  /** MoE: On-Chain Sleuth expert score (0–100). */
  onchain_score?: number | null;
  /** MoE: Deep Memory expert score (0–100). */
  deep_memory_score?: number | null;
  /** MoE: Judge consensus insight (Board Decision), Hebrew. */
  master_insight?: string | null;
  /** MoE: Reasoning path from Judge. */
  reasoning_path?: string | null;
  /** God-Mode: Why did this trade win/lose (structured for RAG). */
  why_win_lose?: string | null;
  /** God-Mode: Which agent was right/wrong (for RAG). */
  agent_verdict?: string | null;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS agent_insights (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(32) NOT NULL,
        trade_id INTEGER NOT NULL,
        entry_conditions TEXT,
        outcome TEXT,
        insight TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_insights_symbol ON agent_insights(symbol)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_insights_created_at ON agent_insights(created_at DESC)`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS tech_score INTEGER`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS risk_score INTEGER`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS psych_score INTEGER`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS macro_score INTEGER`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS onchain_score INTEGER`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS deep_memory_score INTEGER`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS master_insight TEXT`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS reasoning_path TEXT`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS why_win_lose TEXT`;
    await sql`ALTER TABLE agent_insights ADD COLUMN IF NOT EXISTS agent_verdict TEXT`;
    return true;
  } catch (err) {
    console.error('agent_insights ensureTable failed:', err);
    return false;
  }
}

export interface InsertAgentInsightInput {
  symbol: string;
  trade_id: number;
  entry_conditions?: string | null;
  outcome?: string | null;
  insight: string;
  tech_score?: number | null;
  risk_score?: number | null;
  psych_score?: number | null;
  macro_score?: number | null;
  onchain_score?: number | null;
  deep_memory_score?: number | null;
  master_insight?: string | null;
  reasoning_path?: string | null;
  why_win_lose?: string | null;
  agent_verdict?: string | null;
}

export async function insertAgentInsight(row: InsertAgentInsightInput): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const ok = await ensureTable();
    if (!ok) return 0;
    const { rows } = await sql`
      INSERT INTO agent_insights (symbol, trade_id, entry_conditions, outcome, insight, tech_score, risk_score, psych_score, macro_score, onchain_score, deep_memory_score, master_insight, reasoning_path, why_win_lose, agent_verdict)
      VALUES (
        ${row.symbol},
        ${row.trade_id},
        ${row.entry_conditions ?? null},
        ${row.outcome ?? null},
        ${row.insight},
        ${row.tech_score ?? null},
        ${row.risk_score ?? null},
        ${row.psych_score ?? null},
        ${row.macro_score ?? null},
        ${row.onchain_score ?? null},
        ${row.deep_memory_score ?? null},
        ${row.master_insight ?? null},
        ${row.reasoning_path ?? null},
        ${row.why_win_lose ?? null},
        ${row.agent_verdict ?? null}
      )
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('insertAgentInsight failed:', err);
    return 0;
  }
}

export async function listAgentInsightsBySymbol(symbol: string, limit = 50): Promise<AgentInsightRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT id, symbol, trade_id, entry_conditions, outcome, insight, created_at::text, tech_score, risk_score, psych_score, macro_score, onchain_score, deep_memory_score, master_insight, reasoning_path, why_win_lose, agent_verdict
      FROM agent_insights WHERE symbol = ${symbol} ORDER BY created_at DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapAgentInsightRow) as AgentInsightRow[];
  } catch (err) {
    console.error('listAgentInsightsBySymbol failed:', err);
    return [];
  }
}

export async function listAgentInsights(limit = 200): Promise<AgentInsightRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT id, symbol, trade_id, entry_conditions, outcome, insight, created_at::text, tech_score, risk_score, psych_score, macro_score, onchain_score, deep_memory_score, master_insight, reasoning_path, why_win_lose, agent_verdict
      FROM agent_insights ORDER BY created_at DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapAgentInsightRow) as AgentInsightRow[];
  } catch (err) {
    console.error('listAgentInsights failed:', err);
    return [];
  }
}

/** Shared row mapper — keeps column list in sync across all SELECT queries. */
function mapAgentInsightRow(r: Record<string, unknown>): AgentInsightRow {
  return {
    id: Number(r.id),
    symbol: String(r.symbol),
    trade_id: Number(r.trade_id),
    entry_conditions: r.entry_conditions != null ? String(r.entry_conditions) : null,
    outcome: r.outcome != null ? String(r.outcome) : null,
    insight: String(r.insight),
    created_at: String(r.created_at),
    tech_score: r.tech_score != null ? Number(r.tech_score) : null,
    risk_score: r.risk_score != null ? Number(r.risk_score) : null,
    psych_score: r.psych_score != null ? Number(r.psych_score) : null,
    macro_score: r.macro_score != null ? Number(r.macro_score) : null,
    onchain_score: r.onchain_score != null ? Number(r.onchain_score) : null,
    deep_memory_score: r.deep_memory_score != null ? Number(r.deep_memory_score) : null,
    master_insight: r.master_insight != null ? String(r.master_insight) : null,
    reasoning_path: r.reasoning_path != null ? String(r.reasoning_path) : null,
    why_win_lose: r.why_win_lose != null ? String(r.why_win_lose) : null,
    agent_verdict: r.agent_verdict != null ? String(r.agent_verdict) : null,
  };
}

/**
 * Delete all rows from agent_insights (zero-state for production launch).
 * Use with caution. Does not touch AppSettings/settings table.
 */
export async function deleteAllAgentInsights(): Promise<{ deleted: number }> {
  if (!usePostgres()) return { deleted: 0 };
  try {
    const ok = await ensureTable();
    if (!ok) return { deleted: 0 };
    const { rowCount } = await sql`DELETE FROM agent_insights`;
    return { deleted: rowCount ?? 0 };
  } catch (err) {
    console.error('deleteAllAgentInsights failed:', err);
    return { deleted: 0 };
  }
}

/** Agent insights with created_at within the given date range (inclusive). */
export async function listAgentInsightsSince(isoSince: string, limit = 500): Promise<AgentInsightRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const since = new Date(isoSince);
    if (Number.isNaN(since.getTime())) return [];
    const { rows } = await sql`
      SELECT id, symbol, trade_id, entry_conditions, outcome, insight, created_at::text, tech_score, risk_score, psych_score, macro_score, onchain_score, deep_memory_score, master_insight, reasoning_path, why_win_lose, agent_verdict
      FROM agent_insights
      WHERE created_at >= ${since.toISOString()}
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(1, limit), 2000)}
    `;
    return (rows || []).map(mapAgentInsightRow) as AgentInsightRow[];
  } catch (err) {
    console.error('listAgentInsightsSince failed:', err);
    return [];
  }
}

export async function listAgentInsightsInRange(fromDate: string, toDate: string): Promise<AgentInsightRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
    const { rows } = await sql`
      SELECT id, symbol, trade_id, entry_conditions, outcome, insight, created_at::text, tech_score, risk_score, psych_score, macro_score, onchain_score, deep_memory_score, master_insight, reasoning_path, why_win_lose, agent_verdict
      FROM agent_insights
      WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      ORDER BY created_at ASC
    `;
    return (rows || []).map(mapAgentInsightRow) as AgentInsightRow[];
  } catch (err) {
    console.error('listAgentInsightsInRange failed:', err);
    return [];
  }
}
