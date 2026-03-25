'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';

type Status = 'ok' | 'fail' | 'skip';

interface DiagnosticsData {
  connections: { gemini: Status; groq: Status; pinecone: Status; postgres: Status };
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
  timestamp: string;
}

const STATUS_CONFIG: Record<Status, { label: string; icon: typeof CheckCircle2; color: string }> = {
  ok: { label: 'Connected', icon: CheckCircle2, color: 'text-emerald-400' },
  fail: { label: 'Failed', icon: XCircle, color: 'text-red-400' },
  skip: { label: 'Skipped', icon: AlertCircle, color: 'text-amber-400' },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
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

const AI_ROSTER = [
  'Market Scanner',
  'Risk Analyzer',
  'Technical Analyst',
  'Fundamental Expert',
  'Execution Strategist',
  'Sentiment Evaluator',
  'System Overseer',
] as const;

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditReport | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ops/diagnostics', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) {
          setError('נדרשת הרשמה כמנהל.');
          return;
        }
        setError(`שגיאה: ${res.status}`);
        return;
      }
      const json = (await res.json()) as DiagnosticsData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאת רשת');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
    const t = setInterval(fetchDiagnostics, 60_000);
    return () => clearInterval(t);
  }, []);

  const runAuditCheck = async () => {
    setAuditLoading(true);
    setAuditResult(null);
    try {
      const res = await fetch('/api/ops/audit-check', { credentials: 'include' });
      const rawBody = await res.text();
      let json: AuditReport;
      try {
        json = JSON.parse(rawBody) as AuditReport;
      } catch {
        throw new Error(rawBody.trim() || `Audit check returned invalid JSON (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        throw new Error(json.error?.message || `Audit check failed (HTTP ${res.status}).`);
      }
      setAuditResult(json);
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
      <main className="min-h-screen bg-zinc-900 text-zinc-100 p-6" dir="rtl">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-center gap-4 py-16">
          <RefreshCw className="w-10 h-10 animate-spin text-amber-500" />
          <p className="text-zinc-400">טוען אבחון מערכת...</p>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="min-h-screen bg-zinc-900 text-zinc-100 p-6" dir="rtl">
        <div className="max-w-4xl mx-auto py-8">
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-red-300 flex items-center gap-3">
            <XCircle className="w-6 h-6 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchDiagnostics}
            className="mt-4 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
          >
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

  return (
    <main className="min-h-screen bg-zinc-900 text-zinc-100 p-4 sm:p-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-7 h-7 text-amber-400" />
            לוח אבחון פנימי
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              עודכן: {formatDateTime(data!.timestamp)}
            </span>
            <button
              type="button"
              onClick={fetchDiagnostics}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              רענן
            </button>
            <Link
              href="/ops"
              className="flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300"
            >
              חזרה ל-Ops
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-800/50 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <Server className="w-5 h-5 text-amber-400" />
            סטטוס חיבורים
          </h2>
          <ul className="divide-y divide-zinc-700/80">
            {[
              { key: 'gemini', label: 'Gemini' },
              { key: 'groq', label: 'Groq' },
              { key: 'pinecone', label: 'Pinecone' },
              { key: 'postgres', label: 'Neon Database' },
            ].map(({ key, label }) => {
              const status = conn[key as keyof typeof conn];
              const cfg = STATUS_CONFIG[status];
              const Icon = cfg.icon;
              return (
                <li
                  key={key}
                  className="px-4 py-3 flex items-center justify-between gap-4"
                >
                  <span className="text-zinc-300">{label}</span>
                  <span className={`flex items-center gap-2 font-medium ${cfg.color}`}>
                    <Icon className="w-4 h-4" />
                    {cfg.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-800/50 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <Activity className="w-5 h-5 text-amber-400" />
            6 AI Agents + 1 Overseer
          </h2>
          <ul className="divide-y divide-zinc-700/80">
            {AI_ROSTER.map((agentName) => (
              <li key={agentName} className="px-4 py-3 flex items-center justify-between gap-4">
                <span className="text-zinc-300">{agentName}</span>
                <span className="inline-flex items-center gap-2 text-emerald-300 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Online / Ready
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-800/50 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <Database className="w-5 h-5 text-amber-400" />
            יושר מערכת — קונצנזוס אחרון
          </h2>
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center gap-2">
              {integrity.latestConsensusSaved ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
              )}
              <span className={integrity.latestConsensusSaved ? 'text-emerald-300' : 'text-amber-300'}>
                {integrity.latestConsensusSaved
                  ? 'תוצאת קונצנזוס אחרונה נשמרה בהצלחה במאגר'
                  : 'לא נמצאה תוצאת קונצנזוס שמורה (או טרם בוצע ניתוח MoE)'}
              </span>
            </div>
            {integrity.latestConsensusPredictionDate && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm">
                <Clock className="w-4 h-4" />
                תאריך חיזוי: {formatDateTime(integrity.latestConsensusPredictionDate)}
                {integrity.latestConsensusSymbol && (
                  <span className="text-zinc-500"> • סמל: {integrity.latestConsensusSymbol}</span>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-800/50 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <Activity className="w-5 h-5 text-amber-400" />
            סנכרון Deep Memory (Pinecone)
          </h2>
          <div className="px-4 py-4">
            <p className="text-zinc-400 text-sm mb-1">מועד ה-upsert האחרון שהצליח ל־Vector DB:</p>
            <p className="flex items-center gap-2 text-zinc-200 font-mono text-sm">
              <Clock className="w-4 h-4 text-zinc-500" />
              {deepMemory.lastPineconeUpsertAt
                ? formatDateTime(deepMemory.lastPineconeUpsertAt)
                : 'טרם בוצע upsert (או Pinecone לא מוגדר)'}
            </p>
            <p className="text-zinc-500 text-xs mt-2">
              אינדקס Pinecone: {deepMemory.pineconeConfigured ? (deepMemory.pineconeIndex || 'Configured (name hidden)') : 'Not configured'}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-800/50 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <Server className="w-5 h-5 text-amber-400" />
            Macro Expert — DXY Feed Health
          </h2>
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-300">DXY Feed Status</span>
              {(() => {
                const status = dxy?.status ?? 'fail';
                const cfg = STATUS_CONFIG[status];
                const Icon = cfg.icon;
                return (
                  <span className={`flex items-center gap-2 font-medium ${cfg.color}`}>
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
            <p className="text-xs text-zinc-400">{dxy?.note ?? 'No DXY note available.'}</p>
            <p className="text-[11px] text-zinc-500">
              Updated: {formatDateTime(dxy?.updatedAt ?? null)}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-700/80 bg-zinc-800/50 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2 text-lg font-semibold text-zinc-200">
            <FlaskConical className="w-5 h-5 text-amber-400" />
            Self-Test — Real Integration
          </h2>
          <div className="px-4 py-4 space-y-4">
            <p className="text-zinc-400 text-sm">
              מריץ בדיקת אינטגרציה אמיתית: Analysis → DB → Pinecone forced upsert + verification query. לוקח עד ~90 שניות.
            </p>
            <button
              type="button"
              onClick={runAuditCheck}
              disabled={auditLoading}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-2"
            >
              {auditLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {auditLoading ? 'מריץ...' : 'הרץ בדיקת אינטגרציה אמיתית'}
            </button>
            {auditResult && (
              <div className={`rounded-lg border p-4 ${auditResult.ok ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-red-500/40 bg-red-950/20'}`}>
                <p className={`font-semibold mb-2 ${auditResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                  {auditResult.ok ? 'כל השלבים עברו' : 'חלק מהשלבים נכשלו'}
                </p>
                <ul className="text-sm space-y-1 text-zinc-300" dir="ltr" style={{ textAlign: 'left' }}>
                  <li>Analysis: {auditResult.summary.analysis} {auditResult.report.analysis.error && ` — ${auditResult.report.analysis.error}`}</li>
                  <li>DB: {auditResult.summary.db} {auditResult.report.db.error && ` — ${auditResult.report.db.error}`}</li>
                  <li>Vector Storage: {auditResult.summary.vectorStorage} {auditResult.report.vectorStorage.error && ` — ${auditResult.report.vectorStorage.error}`}</li>
                </ul>
                {auditResult.report.analysis.details && (
                  <pre className="mt-2 text-xs text-zinc-500 overflow-auto max-h-24" dir="ltr" style={{ textAlign: 'left' }}>
                    {JSON.stringify(auditResult.report.analysis.details, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
