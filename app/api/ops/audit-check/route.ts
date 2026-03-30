/**
 * GET/POST /api/ops/audit-check — Self-test: runs analysis through all experts,
 * then verifies DB and performs a real Pinecone forced-upsert + query verification.
 * Returns JSON report: Analysis -> DB -> Vector Storage.
 * Requires admin when session enabled.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { runConsensusEngine } from '@/lib/consensus-engine';
import { getDbAsync, saveDbAsync } from '@/lib/db';
import { getLastPineconeUpsertAt } from '@/lib/db/ops-metadata';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  try {
    const result = await runConsensusEngine(MOCK_CONSENSUS_INPUT, {
      timeoutMs: 60_000,
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

  // —— Stage 2: DB (read + write round-trip) ——
  try {
    const rows = await getDbAsync();
    await saveDbAsync(rows);
    report.db = { passed: true, details: { recordsCount: rows?.length ?? 0 } };
  } catch (err) {
    report.db = { passed: false, error: err instanceof Error ? err.message : String(err) };
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
