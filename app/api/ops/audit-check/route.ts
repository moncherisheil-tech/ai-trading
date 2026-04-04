/**
 * GET/POST /api/ops/audit-check — Self-test: validates the full integration pipeline.
 *
 * Stage 1 — Pipeline Integrity (mock, deterministic, always fast):
 *   Uses runConsensusEngine with a synthetic mockPayload that bypasses all LLM calls.
 *   Validates the pipeline assembles, scores, and returns a ConsensusResult correctly.
 *   This CANNOT fail due to Gemini/Groq/Anthropic rate limits, quotas, or timeouts.
 *
 * Stage 2 — DB (lightweight ping):
 *   Writes and reads back a probe key in the settings table.
 *
 * Stage 3 — Pinecone (forced upsert + verification):
 *   Embeds, upserts, and queries a probe vector to confirm vector DB is operational.
 *
 * Timeout budget:
 *   Stage 1: < 1 s  (no network I/O — pure CPU)
 *   Stage 2: ≤ 3 s
 *   Stage 3: ≤ 50 s (embed + upsert + 30 s eventual-consistency sleep + verify)
 *   Total worst-case: ≤ 54 s
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { runConsensusEngine } from '@/lib/consensus-engine';
import { getLastPineconeUpsertAt } from '@/lib/db/ops-metadata';
import { prisma } from '@/lib/prisma';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MOCK_SYMBOL = 'BTCUSDT';

/**
 * Deterministic mock payload — every expert returns a realistic, valid score.
 * The Judge returns a non-empty Hebrew insight.
 * No LLM call is made; runConsensusEngine's mockPayload path is pure CPU.
 */
const MOCK_PAYLOAD = {
  tech:       { tech_score: 72, tech_logic: 'Mock: RSI 52 — neutral-bullish momentum.', is_fallback: false },
  risk:       { risk_score: 68, risk_logic: 'Mock: ATR 2.79% — moderate risk.', is_fallback: false },
  psych:      { psych_score: 65, psych_logic: 'Mock: Fear & Greed neutral.', is_fallback: false },
  macro:      { macro_score: 60, macro_logic: 'Mock: DXY stable — no macro headwinds.', is_fallback: false },
  onchain:    { onchain_score: 70, onchain_logic: 'Mock: On-chain accumulation detected.', is_fallback: false },
  deepMemory: { deep_memory_score: 67, deep_memory_logic: 'Mock: 3/3 recent trades positive.', is_fallback: false },
  judge: {
    master_insight_he: 'בדיקת צינור עצמי — כל 6 המומחים השיבו בהצלחה. הסמכה: PASS.',
    reasoning_path: 'Self-test mock run — all experts functional.',
  },
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

/** INDESTRUCTIBLE CONTRACT: this route NEVER returns HTTP 5xx. */
const AUDIT_FAIL_PAYLOAD = (reason: string) => ({
  ok: false,
  error: { stage: 'handler', message: reason },
  report: {
    analysis: { passed: false, error: reason },
    db: { passed: false, error: reason },
    vectorStorage: { passed: false, error: reason },
    timestamp: new Date().toISOString(),
  },
  summary: { analysis: 'FAIL', db: 'FAIL', vectorStorage: 'FAIL' },
});

export async function GET(): Promise<NextResponse> {
  try {
    return await runAudit();
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    console.error('[ops/audit-check] Fatal unhandled error — returning degraded 200:', msg,
      fatal instanceof Error ? fatal.stack : '');
    return NextResponse.json(AUDIT_FAIL_PAYLOAD(`handler_error: ${msg}`), { status: 200 });
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    return await runAudit();
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    console.error('[ops/audit-check] Fatal unhandled error — returning degraded 200:', msg,
      fatal instanceof Error ? fatal.stack : '');
    return NextResponse.json(AUDIT_FAIL_PAYLOAD(`handler_error: ${msg}`), { status: 200 });
  }
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

  // —— Stage 1: Pipeline Integrity — deterministic mock (no LLM calls) ——
  // Uses the mockPayload path inside runConsensusEngine so every expert returns
  // a known-good score without hitting Gemini/Groq/Anthropic APIs.
  // This stage proves the consensus pipeline assembles and scores correctly.
  try {
    const result = await runConsensusEngine(
      {
        symbol: MOCK_SYMBOL,
        current_price: 43000,
        rsi_14: 52,
        atr_value: 1200,
        atr_pct_of_price: 2.79,
        macd_signal: 0.5,
        volume_profile_summary: 'Mock audit — pipeline self-test.',
        hvn_levels: [42000, 43500, 45000],
        nearest_sr_distance_pct: 2.3,
        volatility_pct: 3.5,
      },
      {
        moeConfidenceThreshold: 75,
        // Use the deterministic mock payload — bypasses ALL LLM network calls.
        mockPayload: MOCK_PAYLOAD,
      }
    );

    const experts = {
      technician:  result.tech_score        != null && Number.isFinite(result.tech_score),
      risk:        result.risk_score        != null && Number.isFinite(result.risk_score),
      psych:       result.psych_score       != null && Number.isFinite(result.psych_score),
      macro:       result.macro_score       != null && Number.isFinite(result.macro_score),
      onchain:     result.onchain_score     != null && Number.isFinite(result.onchain_score),
      deepMemory:  result.deep_memory_score != null && Number.isFinite(result.deep_memory_score),
    };
    const allExpertsOk = Object.values(experts).every(Boolean);
    const insightOk = typeof result.master_insight_he === 'string' && result.master_insight_he.length > 0;
    const passed = allExpertsOk && insightOk;

    if (!passed) {
      // Surface the exact failing condition so the UI shows actionable detail.
      const failingExperts = Object.entries(experts)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);
      const reason = failingExperts.length > 0
        ? `Expert scores missing: ${failingExperts.join(', ')}`
        : !insightOk
          ? `master_insight_he is empty or null (judge fallback may have failed)`
          : 'Unknown pipeline failure';
      console.error('[ops.audit-check] Stage 1 (pipeline) failed —', reason, {
        experts,
        master_insight_he: result.master_insight_he,
        final_confidence: result.final_confidence,
      });
      report.analysis = { passed: false, error: reason, details: { experts, final_confidence: result.final_confidence } };
    } else {
      report.analysis = {
        passed: true,
        details: {
          final_confidence: result.final_confidence,
          consensus_approved: result.consensus_approved,
          experts,
          note: 'Mock payload — LLM calls bypassed; pipeline integrity confirmed.',
        },
      };
    }
  } catch (err) {
    const details = toErrorDetails(err);
    // Print the full stack so Vercel / PM2 logs reveal the real cause.
    console.error('[ops.audit-check] Stage 1 (pipeline) threw unexpectedly:', details.type, details.message,
      err instanceof Error ? err.stack : '');
    report.analysis = {
      passed: false,
      error: `${details.type}: ${details.message}`,
      details: { errorType: details.type },
    };
  }

  // —— Stage 2: DB ping (uses the global Prisma client — same connection as all other DB calls) ——
  // Deliberately avoids lib/db/sql.ts so the probe uses the identical pg pool that powers
  // the rest of the app. Any ECONNREFUSED here is a real infra failure, not a pool mis-config.
  try {
    const probeKey = 'audit_check_db_probe';
    const probeValue = JSON.stringify({ ts: new Date().toISOString() });
    await prisma.$executeRaw`
      INSERT INTO settings (key, value, "updatedAt")
      VALUES (${probeKey}, ${probeValue}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
    `;
    const readRows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM settings WHERE key = ${probeKey} LIMIT 1
    `;
    const readBack = readRows?.[0]?.value;
    if (!readBack) throw new Error('DB probe write succeeded but read-back returned no value.');
    report.db = { passed: true, details: { probe: 'settings table round-trip ok (via Prisma)' } };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[ops.audit-check] Stage 2 (DB) failed:', errMsg);
    report.db = { passed: false, error: errMsg };
  }

  // —— Stage 3: Vector Storage (Pinecone probe) ——
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
      console.error('[ops.audit-check] Stage 3 (Pinecone) failed:', {
        symbol: MOCK_SYMBOL,
        error: probe.error,
        index: probe.index,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    report.vectorStorage = { passed: false, error: errorMsg };
    console.error('[ops.audit-check] Stage 3 (Pinecone) threw:', errorMsg,
      err instanceof Error ? err.stack : '');
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
