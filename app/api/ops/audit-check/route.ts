/**
 * GET/POST /api/ops/audit-check — Self-test: runs analysis through all experts,
 * then verifies DB and performs a real Pinecone forced-upsert + query verification.
 * Returns JSON report: Analysis -> DB -> Vector Storage.
 * Requires admin when session enabled.
 *
 * Timeout budget breakdown (sequential):
 *   Stage 1 — Consensus engine:  ≤ 30 s  (reduced from 60 s; experts staggered 300 ms each)
 *   Stage 2 — DB ping:           ≤  3 s  (single settings write, not a full table delete+reinsert)
 *   Stage 3 — Pinecone probe:    ≤ 50 s  (embed + upsert + 30 s eventual-consistency sleep + verify)
 *   Total worst-case:            ≤ 83 s  → safely within 120 s max
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { runConsensusEngine } from '@/lib/consensus-engine';
import { getLastPineconeUpsertAt } from '@/lib/db/ops-metadata';
import { sql } from '@/lib/db/sql';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';
// Raised from 60 s: probe has a 30 s eventual-consistency sleep; consensus adds up to 30 s.
export const maxDuration = 300;

const MOCK_SYMBOL = 'BTCUSDT';

/** Minimal mock input for consensus engine (audit only). */
const MOCK_CONSENSUS_INPUT = {
  symbol: MOCK_SYMBOL,
  current_price: 43000,
  rsi_14: 52,
  atr_value: 1200,
  atr_pct_of_price: 2.79,
  macd_signal: 0.5,
  volume_profile_summary: 'Mock audit — no real profile.',
  hvn_levels: [42000, 43500, 45000],
  nearest_sr_distance_pct: 2.3,
  volatility_pct: 3.5,
};

interface StageResult {
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

function toErrorDetails(err: unknown): { message: string; type: string } {
  if (err instanceof Error) {
    return { message: err.message, type: err.name || 'Error' };
  }
  return { message: String(err), type: 'UnknownError' };
}

export async function GET(): Promise<NextResponse> {
  return runAudit();
}

export async function POST(): Promise<NextResponse> {
  return runAudit();
}

async function runAudit(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const report: {
    analysis: StageResult;
    db: StageResult;
    vectorStorage: StageResult;
    timestamp: string;
  } = {
    analysis: { passed: false },
    db: { passed: false },
    vectorStorage: { passed: false },
    timestamp: new Date().toISOString(),
  };

  // —— Stage 1: Mock Analysis (all experts) ——
  // timeoutMs capped at 28 s so that this stage completes well within the 30 s budget slice.
  // The absolute failsafe inside runConsensusEngine is max(115 s, timeoutMs+42 s) = 115 s, but
  // individual expert timeouts honour this value; reduce to keep the route responsive.
  try {
    const result = await runConsensusEngine(MOCK_CONSENSUS_INPUT, {
      timeoutMs: 28_000,
      moeConfidenceThreshold: 75,
    });
    const experts: Record<string, boolean> = {
      technician: result.tech_score != null && Number.isFinite(result.tech_score),
      risk: result.risk_score != null && Number.isFinite(result.risk_score),
      psych: result.psych_score != null && Number.isFinite(result.psych_score),
      macro: result.macro_score != null && Number.isFinite(result.macro_score),
      onchain: result.onchain_score != null && Number.isFinite(result.onchain_score),
      deepMemory: result.deep_memory_score != null && Number.isFinite(result.deep_memory_score),
    };
    const allExpertsOk = Object.values(experts).every(Boolean);
    report.analysis = {
      passed: allExpertsOk && typeof result.master_insight_he === 'string' && result.master_insight_he.length > 0,
      details: {
        final_confidence: result.final_confidence,
        consensus_approved: result.consensus_approved,
        experts,
      },
    };
  } catch (err) {
    const details = toErrorDetails(err);
    report.analysis = {
      passed: false,
      error: details.message,
      details: { errorType: details.type },
    };
    console.error('[ops.audit-check] Analysis self-test failed', details);
  }

  // —— Stage 2: DB (lightweight ping — write a probe key, read it back, then delete) ——
  // IMPORTANT: The previous implementation called saveDbAsync(rows) which did a full
  // DELETE FROM prediction_records + sequential re-insert of every row. This was:
  //   1. Destructive — a crash mid-reinsert leaves an empty table.
  //   2. Slow — O(N) queries on large DBs.
  //   3. Misleading — internal errors were caught silently, so report.db always showed passed:true.
  // Replaced with a single read + write to the `settings` table (guaranteed to exist after initDB).
  try {
    const probeKey = 'audit_check_db_probe';
    const probeValue = JSON.stringify({ ts: new Date().toISOString() });
    await sql`
      INSERT INTO settings (key, value, "updatedAt")
      VALUES (${probeKey}, ${probeValue}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
    `;
    const { rows: readRows } = await sql`SELECT value FROM settings WHERE key = ${probeKey} LIMIT 1`;
    const readBack = (readRows?.[0] as { value?: string } | undefined)?.value;
    if (!readBack) throw new Error('DB probe write succeeded but read-back returned no value.');
    report.db = { passed: true, details: { probe: 'settings table round-trip ok' } };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[ops.audit-check] DB self-test failed:', errMsg);
    report.db = { passed: false, error: errMsg };
  }

  // —— Stage 3: Vector Storage (Pinecone forced upsert + read verification) ——
  try {
    const before = await getLastPineconeUpsertAt();
    const { runPineconeUpsertProbe } = await import('@/lib/vector-db');
    const probe = await runPineconeUpsertProbe(MOCK_SYMBOL);
    const after = await getLastPineconeUpsertAt();
    const timestampAdvanced = before !== after && after != null;
    const passed = probe.ok && probe.verifiedByQuery && timestampAdvanced;
    report.vectorStorage = {
      passed,
      details: {
        forcedUpsert: probe.ok,
        verifiedByQuery: probe.verifiedByQuery,
        probeId: probe.probeId,
        index: probe.index,
        lastUpsertBefore: before,
        lastUpsertAfter: after,
        timestampAdvanced,
      },
      ...(probe.error ? { error: probe.error } : {}),
    };
    if (!passed && probe.error) {
      console.error('[ops.audit-check] Vector Storage self-test failed', {
        symbol: MOCK_SYMBOL,
        error: probe.error,
        index: probe.index,
        details: report.vectorStorage.details,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    report.vectorStorage = {
      passed: false,
      error: errorMsg,
    };
    console.error('[ops.audit-check] Vector Storage exception', {
      error: errorMsg,
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
  }

  const allPassed = report.analysis.passed && report.db.passed && report.vectorStorage.passed;
  return NextResponse.json({
    ok: allPassed,
    error: allPassed ? null : {
      stage: !report.analysis.passed ? 'analysis' : !report.db.passed ? 'db' : 'vectorStorage',
      message: report.analysis.error ?? report.db.error ?? report.vectorStorage.error ?? 'Self-test failed',
    },
    report,
    summary: {
      analysis: report.analysis.passed ? 'PASS' : 'FAIL',
      db: report.db.passed ? 'PASS' : 'FAIL',
      vectorStorage: report.vectorStorage.passed ? 'PASS' : 'FAIL',
    },
  });
}
