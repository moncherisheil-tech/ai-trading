'use client';

/**
 * THE ENGINE ROOM — /ops/diagnostics
 * Infrastructure health + Singularity NeuroPlasticity matrix + Episodic Memory feed.
 * Deliberately separated from the Quantum War Room (active trading / MoE debate).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Activity,
  Database,
  Server,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  FlaskConical,
  Brain,
  Cpu,
  TrendingUp,
  Shield,
  Zap,
  BookOpen,
} from 'lucide-react';
import { getOpsDiagnosticsAction, runOpsAuditCheckAction } from '@/app/actions';

// ── Types ──────────────────────────────────────────────────────────────────────────────────────

type Status = 'ok' | 'fail' | 'skip';

interface NeuroPlasticityData {
  techWeight: number;
  riskWeight: number;
  psychWeight: number;
  macroWeight: number;
  onchainWeight: number;
  deepMemoryWeight: number;
  contrarianWeight: number;
  ceoConfidenceThreshold: number;
  ceoRiskTolerance: number;
  robotSlBufferPct: number;
  robotTpAggressiveness: number;
  updatedAt: string | null;
}

interface EpisodicLesson {
  id: string;
  symbol: string;
  marketRegime: string;
  abstractLesson: string;
  createdAt: string;
}

interface WorkerHeartbeat {
  alive: boolean;
  lastBeatAt: string | null;
  staleSinceMs: number | null;
}

interface DiagnosticsData {
  connections: {
    gemini: Status;
    groq: Status;
    anthropic: Status;
    pinecone: Status;
    postgres: Status;
    redis: Status;
  };
  redisPing: { latencyMs: number; error: string | null };
  workerHeartbeat?: WorkerHeartbeat;
  agents: Array<{
    name: string;
    status: 'ok' | 'fail';
    reason: string;
    lastActiveAt: string | null;
  }>;
  systemIntegrity: {
    latestConsensusSaved: boolean;
    latestConsensusPredictionDate: string | null;
    latestConsensusSymbol: string | null;
  };
  deepMemorySync: {
    lastPineconeUpsertAt: string | null;
    pineconeIndex?: string | null;
    pineconeConfigured?: boolean;
  };
  macroHealth: {
    dxy: {
      status: Status;
      value: number | null;
      source: string | null;
      note: string;
      updatedAt: string | null;
    };
  };
  neuroPlasticity: NeuroPlasticityData | null;
  episodicMemory: EpisodicLesson[];
  timestamp: string;
}

interface AuditReport {
  ok: boolean;
  error?: { stage?: string; message?: string } | null;
  report: {
    analysis: { passed: boolean; error?: string; details?: Record<string, unknown> };
    db: { passed: boolean; error?: string; details?: Record<string, unknown> };
    vectorStorage: { passed: boolean; error?: string; details?: Record<string, unknown> };
    timestamp: string;
  };
  summary: { analysis: string; db: string; vectorStorage: string };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  ok:   { label: 'Online',    icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-500/30' },
  fail: { label: 'Offline',   icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-900/20 border-red-500/30' },
  skip: { label: 'Skipped',   icon: AlertCircle,  color: 'text-amber-400',   bg: 'bg-amber-900/20 border-amber-500/30' },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'medium' });
  } catch {
    return iso;
  }
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
  } catch {
    return '—';
  }
}

function weightBar(weight: number): { width: string; color: string } {
  const pct = Math.max(0, Math.min(100, ((weight - 0.1) / (3.0 - 0.1)) * 100));
  const color =
    weight >= 2.0 ? 'bg-emerald-400' :
    weight >= 1.3 ? 'bg-blue-400'    :
    weight >= 0.8 ? 'bg-amber-400'   :
                    'bg-red-400';
  return { width: `${pct.toFixed(1)}%`, color };
}

// ── Expert config ──────────────────────────────────────────────────────────────────────────────

const EXPERT_MATRIX: Array<{
  key: keyof Omit<NeuroPlasticityData, 'ceoConfidenceThreshold' | 'ceoRiskTolerance' | 'robotSlBufferPct' | 'robotTpAggressiveness' | 'updatedAt'>;
  label: string;
  role: string;
  provider: string;
}> = [
  { key: 'techWeight',        label: 'Technician',        role: 'Expert 1',  provider: 'Gemini/Groq' },
  { key: 'riskWeight',        label: 'Risk Manager',      role: 'Expert 2',  provider: 'Gemini' },
  { key: 'psychWeight',       label: 'Market Psychologist', role: 'Expert 3', provider: 'Gemini' },
  { key: 'macroWeight',       label: 'Macro & Order Book', role: 'Expert 4', provider: 'Groq' },
  { key: 'onchainWeight',     label: 'On-Chain Sleuth',   role: 'Expert 5',  provider: 'Gemini' },
  { key: 'deepMemoryWeight',  label: 'Deep Memory',       role: 'Expert 6',  provider: 'Gemini + Pinecone' },
  { key: 'contrarianWeight',  label: 'Contrarian',        role: 'Expert 7',  provider: 'Gemini' },
];

// ── All-OFFLINE fallback — used when the Server Action crashes completely ──────────────────────
// The UI renders this instead of blowing up or showing a blank screen.
// All connection indicators go RED; the user sees the system is down, not a JS crash.
const OFFLINE_FALLBACK_DATA: DiagnosticsData = {
  connections: { gemini: 'skip', groq: 'skip', anthropic: 'skip', pinecone: 'skip', postgres: 'fail', redis: 'fail' },
  redisPing:   { latencyMs: 0, error: 'Server unreachable' },
  workerHeartbeat: { alive: false, lastBeatAt: null, staleSinceMs: null },
  agents: [],
  systemIntegrity: { latestConsensusSaved: false, latestConsensusPredictionDate: null, latestConsensusSymbol: null },
  deepMemorySync:  { lastPineconeUpsertAt: null, pineconeIndex: null, pineconeConfigured: false },
  macroHealth:     { dxy: { status: 'fail', value: null, source: null, note: 'Server unreachable', updatedAt: null } },
  neuroPlasticity: null,
  episodicMemory:  [],
  timestamp:       new Date().toISOString(),
};

// ── Main component ─────────────────────────────────────────────────────────────────────────────

export default function EngineRoomPage() {
  const [data,         setData]         = useState<DiagnosticsData | null>(null);
  const [loading,      setLoading]      = useState(true);
  // staleError: set when a poll fails but we have prior data — shown as a banner, not a blank screen
  const [staleError,   setStaleError]   = useState<string | null>(null);
  // hardError: set only on the very first load failure (no prior data to fall back to)
  const [hardError,    setHardError]    = useState<string | null>(null);
  const [auditResult,  setAuditResult]  = useState<AuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // Ref tracks the latest data value so fetchDiagnostics can check it without
  // needing `data` as a useCallback dependency (which would cause an infinite
  // fetch loop: data change → new callback → useEffect re-fires immediately).
  const dataRef = useRef<DiagnosticsData | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  // PHASE 3 — NUCLEAR LOGGING: mounted signal
  useEffect(() => {
    console.log('[DIAG][1] Component mounted — EngineRoomPage hydrated on client');
  }, []);

  // Stable callback — never recreated, never triggers useEffect re-runs.
  const fetchDiagnostics = useCallback(async () => {
    // PHASE 3 — NUCLEAR LOGGING: fetch start
    console.log('[DIAG][2] Initiating Server Action — getOpsDiagnosticsAction()');
    setLoading(true);
    try {
      // If the Server Action itself throws at the framework level, treat it as
      // a network failure and fall through to the offline handler below.
      let out: Awaited<ReturnType<typeof getOpsDiagnosticsAction>>;
      try {
        out = await getOpsDiagnosticsAction();
      } catch (innerErr) {
        // PHASE 3 — NUCLEAR LOGGING: framework-level action throw
        console.error('[DIAG][3-ERR] Server Action threw at framework level:', innerErr);
        out = { success: false, error: 'שגיאת רשת — לא ניתן להגיע לשרת' };
      }

      // PHASE 3 — NUCLEAR LOGGING: raw response
      console.log('[DIAG][3] Raw action response received — success:', out.success, '| error:', (out as { error?: string }).error ?? null, '| hasData:', 'data' in out && out.data != null);

      if (!out.success) {
        if (out.error === 'UNAUTHORIZED') {
          setHardError('נדרשת הרשמה כמנהל.');
          return;
        }
        const msg = out.error || 'שגיאה בטעינת אבחון';
        console.warn('[DIAG][4-WARN] Action returned failure — falling back. Message:', msg);
        if (dataRef.current !== null) {
          setStaleError(msg);
        } else {
          setData(OFFLINE_FALLBACK_DATA);
          setHardError(msg);
        }
        return;
      }

      // PHASE 3 — NUCLEAR LOGGING: successful data commit
      const incoming = out.data as DiagnosticsData;
      console.log('[DIAG][4] State updated — data keys:', incoming != null ? Object.keys(incoming) : 'NULL — CRITICAL!');

      // PHASE 2 — BULLETPROOFING: if the action succeeded but returned no data,
      // fall back to OFFLINE rather than committing null and crashing the render.
      if (incoming == null) {
        console.error('[DIAG][4-CRITICAL] Action reported success but data is null/undefined — using OFFLINE fallback');
        setData(OFFLINE_FALLBACK_DATA);
        setHardError('שגיאה פנימית: נתונים ריקים התקבלו מהשרת');
        return;
      }

      // Fresh data — clear any stale-error banner.
      setData(incoming);
      setStaleError(null);
      setHardError(null);
    } catch (e) {
      // Last-resort catch — should be unreachable given the inner guard above,
      // but guarantees the component never crashes with an unhandled rejection.
      const msg = e instanceof Error ? e.message : 'שגיאת רשת';
      console.error('[DIAG][CATCH] Last-resort outer catch fired:', e);
      if (dataRef.current !== null) {
        setStaleError(msg);
      } else {
        setData(OFFLINE_FALLBACK_DATA);
        setHardError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps — stable reference, no infinite loop.

  useEffect(() => {
    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (!isMounted) return;
      try {
        await fetchDiagnostics();
      } finally {
        if (isMounted) {
          // Wait exactly 10 s AFTER the last request finished before firing again.
          timerId = setTimeout(poll, 10_000);
        }
      }
    };

    poll();

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [fetchDiagnostics]);

  const runAuditCheck = async () => {
    setAuditLoading(true);
    setAuditResult(null);
    try {
      const out = await runOpsAuditCheckAction();
      if (!out.success) throw new Error(out.error);
      setAuditResult(out.data as AuditReport);
    } catch (e) {
      setAuditResult({
        ok: false,
        report: {
          analysis: { passed: false, error: e instanceof Error ? e.message : 'Network error' },
          db: { passed: false },
          vectorStorage: { passed: false },
          timestamp: new Date().toISOString(),
        },
        summary: { analysis: 'FAIL', db: 'FAIL', vectorStorage: 'FAIL' },
      });
    } finally {
      setAuditLoading(false);
    }
  };

  // ── Loading splash — only on the very first render before any data arrives ──
  if (loading && !data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6" dir="rtl">
        <div className="max-w-5xl mx-auto flex flex-col items-center justify-center gap-4 py-20">
          <Cpu className="w-12 h-12 text-amber-400 animate-pulse" />
          <p className="text-zinc-400 text-sm tracking-wide">ENGINE ROOM — טוען נתוני מערכת...</p>
        </div>
      </main>
    );
  }

  // PHASE 2 — BULLETPROOFING: replace `data!` non-null assertion with a true
  // null-guard. If React's async batching ever serves a render tick where
  // `loading` just flipped to false but `data` hasn't committed yet, the old
  // `data!` assertion lied and the render crashed. This guard catches that gap.
  const safeData = data ?? OFFLINE_FALLBACK_DATA;
  console.log('[DIAG][5] Render — safeData timestamp:', safeData.timestamp, '| loading:', loading, '| hardError:', hardError);

  return (
    <DiagnosticsBody
      data={safeData}
      loading={loading}
      fetchDiagnostics={fetchDiagnostics}
      staleError={staleError}
      hardError={hardError}
      auditResult={auditResult}
      auditLoading={auditLoading}
      runAuditCheck={runAuditCheck}
    />
  );
}

// X-Ray: synchronous render + derived fields run inside try/catch so SSR throws log to the terminal
function DiagnosticsBody({
  data,
  loading,
  fetchDiagnostics,
  staleError,
  hardError,
  auditResult,
  auditLoading,
  runAuditCheck,
}: {
  data: DiagnosticsData;
  loading: boolean;
  fetchDiagnostics: () => void;
  staleError: string | null;
  hardError: string | null;
  auditResult: AuditReport | null;
  auditLoading: boolean;
  runAuditCheck: () => void | Promise<void>;
}) {
  try {
  // PHASE 2 — BULLETPROOFING: every derived field uses a fallback so a partial
  // payload from the Server Action can never crash the render tree.
  const conn        = data.connections        ?? OFFLINE_FALLBACK_DATA.connections;
  const integrity   = data.systemIntegrity    ?? OFFLINE_FALLBACK_DATA.systemIntegrity;
  const deepMemory  = data.deepMemorySync     ?? OFFLINE_FALLBACK_DATA.deepMemorySync;
  const dxy         = data.macroHealth?.dxy   ?? OFFLINE_FALLBACK_DATA.macroHealth.dxy;
  const np          = data.neuroPlasticity    ?? null;
  const episodes    = data.episodicMemory     ?? [];
  const redisPing   = data.redisPing          ?? OFFLINE_FALLBACK_DATA.redisPing;
  const workerHb    = data.workerHeartbeat    ?? OFFLINE_FALLBACK_DATA.workerHeartbeat;

  const infraConnections: Array<{ key: string; label: string; icon: typeof Server; extra?: string }> = [
    { key: 'postgres', label: 'Quantum Core DB (Postgres)', icon: Database },
    { key: 'redis',    label: `Redis Cache${redisPing?.latencyMs != null && redisPing.latencyMs > 0 ? ` — ${redisPing.latencyMs}ms` : ''}`, icon: Zap },
    { key: 'pinecone', label: 'Pinecone Vector DB', icon: Brain },
    { key: 'gemini',   label: 'Gemini AI', icon: Cpu },
    { key: 'groq',     label: 'Groq LLM', icon: Cpu },
    { key: 'anthropic',label: 'Anthropic Claude', icon: Cpu },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-4 sm:p-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-zinc-800">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Cpu className="w-7 h-7 text-amber-400" />
              ENGINE ROOM — חדר המנועים
            </h1>
            <p className="text-xs text-zinc-500 mt-1">תשתית · NeuroPlasticity · זיכרון אפיזודי</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">עודכן: {formatDateTime(data.timestamp)}</span>
            <button type="button" onClick={fetchDiagnostics} disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              רענן
            </button>
            <Link href="/ops" className="flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300">
              Ops
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* ── Hard-error banner (first load failed, showing OFFLINE fallback) ──────────────────── */}
        {hardError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 px-4 py-3 flex items-start gap-3 shadow-[0_0_20px_rgba(244,63,94,0.10)]">
            <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-rose-300 font-semibold text-sm">שגיאה בטעינת אבחון — מציג סטטוס OFFLINE</p>
              <p className="text-rose-400/70 text-xs mt-0.5 truncate">{hardError}</p>
            </div>
            <button type="button" onClick={fetchDiagnostics}
              className="ml-auto shrink-0 text-xs text-rose-300 hover:text-rose-200 underline underline-offset-2">
              נסה שוב
            </button>
          </div>
        )}

        {/* ── Stale-data banner (poll failed but prior data is still displayed) ────────────────── */}
        {staleError && !hardError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 px-4 py-2.5 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-amber-300 text-xs flex-1">
              <span className="font-semibold">עדכון אחרון נכשל — מוצגים נתונים ישנים.</span>{' '}
              <span className="text-amber-400/70">{staleError}</span>
            </p>
            <button type="button" onClick={fetchDiagnostics}
              className="shrink-0 text-xs text-amber-300 hover:text-amber-200 underline underline-offset-2">
              רענן
            </button>
          </div>
        )}

        {/* ── Infrastructure Health ───────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <Server className="w-5 h-5 text-amber-400" />
            תשתית — Infrastructure Health
          </h2>
          <ul className="divide-y divide-zinc-700/60">
            {infraConnections.map(({ key, label, icon: Icon }) => {
              const status = conn[key as keyof typeof conn] ?? 'skip';
              const cfg = STATUS_CONFIG[status as Status];
              const SIcon = cfg.icon;
              return (
                <li key={key} className="px-4 py-3 flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-zinc-300">
                    <Icon className="w-4 h-4 text-zinc-500 shrink-0" />
                    {label}
                  </span>
                  <span className={`flex items-center gap-2 font-medium text-sm ${cfg.color}`}>
                    <SIcon className="w-4 h-4" />
                    {cfg.label}
                  </span>
                </li>
              );
            })}
          </ul>
          {redisPing?.error && (
            <p className="px-4 pb-3 text-xs text-red-400">Redis error: {redisPing.error}</p>
          )}
        </section>

        {/* ── BullMQ Worker Status ───────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <Activity className="w-5 h-5 text-amber-400" />
            Alpha Scanner Worker — BullMQ
          </h2>
          <div className="px-4 py-4 flex items-center justify-between gap-4">
            {workerHb?.alive ? (
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-5 h-5" />
                  Worker ALIVE
                </span>
                <span className="text-xs text-zinc-500">
                  Last heartbeat: {formatTimeAgo(workerHb.lastBeatAt)}
                  {workerHb.staleSinceMs != null && workerHb.staleSinceMs > 90_000 && (
                    <span className="ml-2 text-amber-400"> — beat is {Math.round(workerHb.staleSinceMs / 1000)}s old</span>
                  )}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-red-400 font-semibold">
                  <XCircle className="w-5 h-5" />
                  Worker DEAD — Alpha Scanner offline
                </span>
                <span className="text-xs text-zinc-500">
                  {conn.redis === 'fail'
                    ? 'Redis unavailable — cannot read heartbeat'
                    : 'Heartbeat key expired (TTL 5 min). Run: pm2 restart queue-worker'}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── NeuroPlasticity Matrix ──────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-200">
              <Brain className="w-5 h-5 text-purple-400" />
              Singularity NeuroPlasticity Matrix
            </h2>
            {np?.updatedAt && (
              <span className="text-xs text-zinc-500">
                עודכן {formatTimeAgo(np.updatedAt)}
              </span>
            )}
          </div>

          {!np ? (
            <div className="px-4 py-6 text-center text-zinc-500 text-sm">
              SystemNeuroPlasticity טרם אותחל — הרץ RL post-mortem לפחות פעם אחת.
            </div>
          ) : (
            <>
              {/* 7-Expert Weight Matrix */}
              <div className="px-4 pt-4 pb-2">
                <p className="text-xs text-zinc-500 mb-3">
                  משקל סינפטי לכל מומחה [0.10 – 3.00] · מתעדכן לאחר כל post-mortem RL
                </p>
                <div className="space-y-2">
                  {EXPERT_MATRIX.map(({ key, label, role, provider }) => {
                    const weight = np[key] as number;
                    const { width, color } = weightBar(weight);
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 w-14 shrink-0 font-mono">{role}</span>
                            <span className="text-sm text-zinc-200">{label}</span>
                            <span className="text-[10px] text-zinc-600">{provider}</span>
                          </div>
                          <span className={`text-sm font-mono font-bold ${
                            weight >= 2.0 ? 'text-emerald-400' :
                            weight >= 1.3 ? 'text-blue-400' :
                            weight >= 0.8 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {weight.toFixed(3)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* CEO & Robot Parameters */}
              <div className="px-4 pt-3 pb-4 border-t border-zinc-700/60 mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-zinc-800/60 p-3 text-center">
                  <Shield className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                  <p className="text-[10px] text-zinc-500 mb-1">CEO Confidence Gate</p>
                  <p className="text-lg font-bold font-mono text-amber-300">{np.ceoConfidenceThreshold.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-zinc-800/60 p-3 text-center">
                  <TrendingUp className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="text-[10px] text-zinc-500 mb-1">CEO Risk Tolerance</p>
                  <p className="text-lg font-bold font-mono text-blue-300">×{np.ceoRiskTolerance.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-zinc-800/60 p-3 text-center">
                  <Activity className="w-4 h-4 text-red-400 mx-auto mb-1" />
                  <p className="text-[10px] text-zinc-500 mb-1">Robot SL Buffer</p>
                  <p className="text-lg font-bold font-mono text-red-300">{np.robotSlBufferPct.toFixed(2)}%</p>
                </div>
                <div className="rounded-lg bg-zinc-800/60 p-3 text-center">
                  <Zap className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-[10px] text-zinc-500 mb-1">Robot TP Aggressiveness</p>
                  <p className="text-lg font-bold font-mono text-emerald-300">×{np.robotTpAggressiveness.toFixed(2)}</p>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ── Episodic Memory Feed ────────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <BookOpen className="w-5 h-5 text-violet-400" />
            Episodic Memory — לקחים שה-AI כתב לעצמו
          </h2>
          {episodes.length === 0 ? (
            <div className="px-4 py-6 text-center text-zinc-500 text-sm">
              אין רשומות זיכרון אפיזודי עדיין. הרץ RL post-mortem לפחות פעם אחת.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-700/60">
              {episodes.map((ep) => (
                <li key={ep.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-amber-400">{ep.symbol}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{ep.marketRegime}</span>
                    </div>
                    <span className="text-[11px] text-zinc-600">{formatTimeAgo(ep.createdAt)}</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed" dir="ltr" style={{ textAlign: 'left' }}>
                    {ep.abstractLesson}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 7 MoE Agents Status ─────────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <Activity className="w-5 h-5 text-amber-400" />
            7 MoE Experts + Overseer CEO — סטטוס
          </h2>
          <ul className="divide-y divide-zinc-700/60">
            {(data.agents ?? []).map((agent) => {
              const cfg = STATUS_CONFIG[agent.status];
              const Icon = cfg.icon;
              const isExpert7 = agent.name.includes('Expert 7') || agent.name.includes('Contrarian');
              return (
                <li key={agent.name} className={`px-4 py-3 ${isExpert7 ? 'bg-purple-950/10 border-l-2 border-purple-500/40' : ''}`}>
                  <div className="flex items-center justify-between gap-4">
                    <span className={`text-zinc-300 ${isExpert7 ? 'text-purple-300 font-medium' : ''}`}>{agent.name}</span>
                    <span className={`inline-flex items-center gap-2 font-medium text-sm ${cfg.color}`}>
                      <Icon className="w-4 h-4" />
                      {agent.status === 'ok' ? 'Online / Ready' : 'Unavailable'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{agent.reason}</p>
                  <p className="text-[11px] text-zinc-600">Last active: {formatDateTime(agent.lastActiveAt)}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── System Integrity ────────────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <Database className="w-5 h-5 text-amber-400" />
            יושר מערכת — קונצנזוס אחרון
          </h2>
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center gap-2">
              {integrity.latestConsensusSaved
                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                : <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />}
              <span className={integrity.latestConsensusSaved ? 'text-emerald-300' : 'text-amber-300'}>
                {integrity.latestConsensusSaved
                  ? 'תוצאת קונצנזוס אחרונה נשמרה בהצלחה'
                  : 'לא נמצאה תוצאת קונצנזוס שמורה'}
              </span>
            </div>
            {integrity.latestConsensusPredictionDate && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm">
                <Clock className="w-4 h-4" />
                {formatDateTime(integrity.latestConsensusPredictionDate)}
                {integrity.latestConsensusSymbol && (
                  <span className="text-zinc-500"> · {integrity.latestConsensusSymbol}</span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Deep Memory Sync ────────────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <Brain className="w-5 h-5 text-amber-400" />
            Deep Memory — Pinecone Vector DB
          </h2>
          <div className="px-4 py-4">
            <p className="text-zinc-400 text-sm mb-1">מועד ה-upsert האחרון:</p>
            <p className="flex items-center gap-2 text-zinc-200 font-mono text-sm">
              <Clock className="w-4 h-4 text-zinc-500" />
              {deepMemory.lastPineconeUpsertAt
                ? formatDateTime(deepMemory.lastPineconeUpsertAt)
                : 'טרם בוצע upsert'}
            </p>
            <p className="text-zinc-500 text-xs mt-2">
              Index: {deepMemory.pineconeConfigured
                ? (deepMemory.pineconeIndex || 'Configured')
                : 'Not configured'} · Dim: 768 (Gemini gemini-embedding-001)
            </p>
          </div>
        </section>

        {/* ── DXY Feed ────────────────────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <Server className="w-5 h-5 text-amber-400" />
            Macro Expert — DXY Feed
          </h2>
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-300">DXY Status</span>
              {(() => {
                const status = dxy?.status ?? 'fail';
                const cfg = STATUS_CONFIG[status];
                const Icon = cfg.icon;
                return (
                  <span className={`flex items-center gap-2 font-medium text-sm ${cfg.color}`}>
                    <Icon className="w-4 h-4" />
                    {cfg.label}
                  </span>
                );
              })()}
            </div>
            <div className="text-sm text-zinc-300">
              Value: <span className="font-mono text-zinc-100">{typeof dxy?.value === 'number' ? dxy.value.toFixed(3) : '—'}</span>
              <span className="text-zinc-500"> · Source: {dxy?.source ?? '—'}</span>
            </div>
            <p className="text-xs text-zinc-400">{dxy?.note ?? ''}</p>
            <p className="text-[11px] text-zinc-500">Updated: {formatDateTime(dxy?.updatedAt ?? null)}</p>
          </div>
        </section>

        {/* ── Self-Test ────────────────────────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-base font-semibold text-zinc-200">
            <FlaskConical className="w-5 h-5 text-amber-400" />
            Self-Test — Real Integration
          </h2>
          <div className="px-4 py-4 space-y-4">
            <p className="text-zinc-400 text-sm">
              בדיקת Pipeline (ללא LLM) + DB round-trip + Pinecone upsert. שלב 1 הוא דטרמיניסטי — לא ניתן להיכשל מ-Gemini/Groq. לוקח עד ~60 שניות.
            </p>
            <button type="button" onClick={runAuditCheck} disabled={auditLoading}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-2">
              {auditLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {auditLoading ? 'מריץ...' : 'הרץ בדיקת אינטגרציה'}
            </button>
            {auditResult && (
              <div className={`rounded-lg border p-4 ${auditResult.ok ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-red-500/40 bg-red-950/20'}`}>
                <p className={`font-semibold mb-2 ${auditResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                  {auditResult.ok ? 'כל השלבים עברו' : 'חלק מהשלבים נכשלו'}
                </p>
                <ul className="text-sm space-y-1 text-zinc-300" dir="ltr" style={{ textAlign: 'left' }}>
                  <li>Analysis: {auditResult.summary.analysis}{auditResult.report.analysis.error && ` — ${auditResult.report.analysis.error}`}</li>
                  <li>DB: {auditResult.summary.db}{auditResult.report.db.error && ` — ${auditResult.report.db.error}`}</li>
                  <li>Vector Storage: {auditResult.summary.vectorStorage}{auditResult.report.vectorStorage.error && ` — ${auditResult.report.vectorStorage.error}`}</li>
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error('🚨 X-RAY CRASH LOG 🚨 [DiagnosticsBody]', e.name, e.message, e.stack);
    return <div>SSR CRASH: Read Terminal</div>;
  }
}
