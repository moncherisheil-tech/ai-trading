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

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
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
 */
export async function deleteAllAgentInsights(): Promise<{ deleted: number }> {
  if (!usePostgres()) return { deleted: 0 };
  try {
    const { rowCount } = await sql`DELETE FROM agent_insights`;
    return { deleted: rowCount ?? 0 };
  } catch (err) {
    console.error('deleteAllAgentInsights failed:', err);
    return { deleted: 0 };
  }
}

/** Agent insights since a given ISO timestamp. */
export async function listAgentInsightsSince(isoSince: string, limit = 500): Promise<AgentInsightRow[]> {
  if (!usePostgres()) return [];
  try {
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
