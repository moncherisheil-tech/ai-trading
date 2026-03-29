/**
 * 30-day expert "hit rate" from post-mortem rows (agent_insights) for dynamic MoE weights.
 */

import { listAgentInsightsSince, type AgentInsightRow } from '@/lib/db/agent-insights';

export type BoardExpertKey = 'technician' | 'risk' | 'psych' | 'macro' | 'onchain' | 'deepMemory';

const THRESHOLD = 55;

function parsePnlPctFromOutcome(outcome: string | null | undefined): number | null {
  if (!outcome) return null;
  const m = /pnl_pct=([-0-9.]+)/i.exec(outcome);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function updateHit(stats: { wins: number; total: number }, score: number | null | undefined, movePct: number): void {
  if (score == null || !Number.isFinite(score) || !Number.isFinite(movePct)) return;
  const bullishLeaning = score >= THRESHOLD;
  const correct = (bullishLeaning && movePct > 0) || (!bullishLeaning && movePct < 0);
  if (correct) stats.wins += 1;
  stats.total += 1;
}

function finalize(stats: { wins: number; total: number }): number {
  if (stats.total < 3) return 50;
  return Math.round((stats.wins / stats.total) * 1000) / 10;
}

/**
 * Hit rates from closed-trade post-mortems in the last 30 days.
 * macro/onchain/deepMemory default to 50 unless enough labeled data exists (scores often absent on older rows).
 */
export async function getExpertHitRates30d(options?: {
  symbol?: string | null;
}): Promise<Record<BoardExpertKey, number>> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let rows: AgentInsightRow[] = await listAgentInsightsSince(since, 800);
  if (options?.symbol) {
    const sym = options.symbol.trim().toUpperCase();
    rows = rows.filter((r) => r.symbol.toUpperCase() === sym);
  }

  const tech = { wins: 0, total: 0 };
  const risk = { wins: 0, total: 0 };
  const psych = { wins: 0, total: 0 };
  const macro = { wins: 0, total: 0 };
  const onchain = { wins: 0, total: 0 };
  const deep = { wins: 0, total: 0 };

  for (const row of rows) {
    const move = parsePnlPctFromOutcome(row.outcome);
    if (move == null) continue;
    updateHit(tech, row.tech_score, move);
    updateHit(risk, row.risk_score, move);
    updateHit(psych, row.psych_score, move);
    // Optional future columns — if missing, totals stay 0 → neutral 50.
    const macroScore = (row as { macro_score?: number | null }).macro_score;
    const onchainScore = (row as { onchain_score?: number | null }).onchain_score;
    const deepScore = (row as { deep_memory_score?: number | null }).deep_memory_score;
    updateHit(macro, macroScore ?? null, move);
    updateHit(onchain, onchainScore ?? null, move);
    updateHit(deep, deepScore ?? null, move);
  }

  return {
    technician: finalize(tech),
    risk: finalize(risk),
    psych: finalize(psych),
    macro: finalize(macro),
    onchain: finalize(onchain),
    deepMemory: finalize(deep),
  };
}

/** 7-day window for confidence decay (Singularity). */
export async function getExpertHitRates7d(options?: {
  symbol?: string | null;
}): Promise<Record<BoardExpertKey, number>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let rows: AgentInsightRow[] = await listAgentInsightsSince(since, 400);
  if (options?.symbol) {
    const sym = options.symbol.trim().toUpperCase();
    rows = rows.filter((r) => r.symbol.toUpperCase() === sym);
  }
  const tech = { wins: 0, total: 0 };
  const risk = { wins: 0, total: 0 };
  const psych = { wins: 0, total: 0 };
  const macro = { wins: 0, total: 0 };
  const onchain = { wins: 0, total: 0 };
  const deep = { wins: 0, total: 0 };
  for (const row of rows) {
    const move = parsePnlPctFromOutcome(row.outcome);
    if (move == null) continue;
    updateHit(tech, row.tech_score, move);
    updateHit(risk, row.risk_score, move);
    updateHit(psych, row.psych_score, move);
    const macroScore = (row as { macro_score?: number | null }).macro_score;
    const onchainScore = (row as { onchain_score?: number | null }).onchain_score;
    const deepScore = (row as { deep_memory_score?: number | null }).deep_memory_score;
    updateHit(macro, macroScore ?? null, move);
    updateHit(onchain, onchainScore ?? null, move);
    updateHit(deep, deepScore ?? null, move);
  }
  return {
    technician: finalize(tech),
    risk: finalize(risk),
    psych: finalize(psych),
    macro: finalize(macro),
    onchain: finalize(onchain),
    deepMemory: finalize(deep),
  };
}
