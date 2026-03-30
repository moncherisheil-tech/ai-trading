'use client';

/**
 * THE ENGINE ROOM — /ops/diagnostics
 * Infrastructure health + Singularity NeuroPlasticity matrix + Episodic Memory feed.
 * Deliberately separated from the Quantum War Room (active trading / MoE debate).
 */

import { useState, useEffect, useCallback } from 'react';
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

// ── Main component ─────────────────────────────────────────────────────────────────────────────

export default function EngineRoomPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await getOpsDiagnosticsAction();
      if (!out.success) {
        if (out.error === 'UNAUTHORIZED') { setError('נדרשת הרשמה כמנהל.'); return; }
        setError(out.error || 'שגיאה בטעינת אבחון');
        return;
      }
      setData(out.data as DiagnosticsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאת רשת');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagnostics();
    const t = setInterval(fetchDiagnostics, 60_000);
    return () => clearInterval(t);
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

  if (loading && !data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6" dir="rtl">
        <div className="max-w-5xl mx-auto flex flex-col items-center justify-center gap-4 py-20">
          <div className="relative">
            <Cpu className="w-12 h-12 text-amber-400 animate-pulse" />
          </div>
          <p className="text-zinc-400 text-sm tracking-wide">ENGINE ROOM — טוען נתוני מערכת...</p>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6" dir="rtl">
        <div className="max-w-5xl mx-auto py-8">
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-red-300 flex items-center gap-3">
            <XCircle className="w-6 h-6 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={fetchDiagnostics}
            className="mt-4 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors">
            נסה שוב
          </button>
        </div>
      </main>
    );
  }

  const conn = data!.connections;
  const integrity = data!.systemIntegrity;
  const deepMemory = data!.deepMemorySync;
  const dxy = data!.macroHealth?.dxy;
  const np = data!.neuroPlasticity;
  const episodes = data!.episodicMemory ?? [];
  const redisPing = data!.redisPing;

  const infraConnections: Array<{ key: string; label: string; icon: typeof Server; extra?: string }> = [
    { key: 'postgres', label: 'Quantum Core DB (Postgres)', icon: Database },
    { key: 'redis',    label: `Redis Cache${redisPing?.latencyMs > 0 ? ` — ${redisPing.latencyMs}ms` : ''}`, icon: Zap },
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
            <span className="text-xs text-zinc-500">עודכן: {formatDateTime(data!.timestamp)}</span>
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
            {data!.agents.map((agent) => {
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
              מריץ בדיקת אינטגרציה אמיתית: Analysis → DB → Pinecone upsert + verification. לוקח עד ~90 שניות.
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
}
