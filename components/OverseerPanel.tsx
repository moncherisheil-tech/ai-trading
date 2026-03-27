'use client';

import { useEffect, useState } from 'react';
import { Shield, Activity, Settings, RefreshCw, CheckCircle, XCircle, MinusCircle } from 'lucide-react';
import { getOverseerHealthAction, getOverseerLogsAction } from '@/app/actions';
import NeuralConsensusVisualizer from '@/components/NeuralConsensusVisualizer';

type OverseerLog = {
  symbol: string;
  master_insight_he: string | null;
  final_confidence: number | null;
  prediction_date: string;
  consensus_approved: boolean;
  debate_resolution?: string | null;
  tech_score?: number | null;
  risk_score?: number | null;
  psych_score?: number | null;
  macro_score?: number | null;
  onchain_score?: number | null;
  deep_memory_score?: number | null;
  predicted_direction?: string | null;
};

type Health = {
  gemini: 'ok' | 'skip';
  groq: 'ok' | 'skip';
  pinecone: 'ok' | 'skip';
  db: 'ok' | 'fail';
  timestamp?: string;
};

type AppSettings = {
  neural?: { moeConfidenceThreshold?: number };
  risk?: { riskToleranceLevel?: 'strict' | 'moderate' | 'aggressive' };
};

type OverseerLogsPayload = {
  logs?: OverseerLog[];
};

function StatusIcon({ status }: { status: 'ok' | 'skip' | 'fail' }) {
  if (status === 'ok') return <CheckCircle className="w-4 h-4 text-emerald-400" aria-hidden />;
  if (status === 'fail') return <XCircle className="w-4 h-4 text-red-400" aria-hidden />;
  return <MinusCircle className="w-4 h-4 text-zinc-500" aria-hidden />;
}

export default function OverseerPanel() {
  const [logs, setLogs] = useState<OverseerLog[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moeThreshold, setMoeThreshold] = useState<number>(75);
  const [riskLevel, setRiskLevel] = useState<'strict' | 'moderate' | 'aggressive'>('strict');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [logsOut, healthOut, settingsRes] = await Promise.all([
        getOverseerLogsAction(),
        getOverseerHealthAction(),
        fetch('/api/settings/app', { credentials: 'include', cache: 'no-store' }),
      ]);
      if (logsOut.success) {
        const payload = (logsOut.data ?? null) as OverseerLogsPayload | null;
        setLogs(Array.isArray(payload?.logs) ? payload.logs : []);
      }
      if (healthOut.success) {
        const payload = (healthOut.data ?? null) as Health | null;
        setHealth(payload);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data);
        if (data.neural?.moeConfidenceThreshold != null) setMoeThreshold(Number(data.neural.moeConfidenceThreshold));
        if (data.risk?.riskToleranceLevel) setRiskLevel(data.risk.riskToleranceLevel);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleSaveStrictness = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/settings/app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          neural: { moeConfidenceThreshold: moeThreshold },
          risk: { riskToleranceLevel: riskLevel },
        }),
      });
      if (res.ok) await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  if (loading && !health && !settings) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/40 p-6">
        <p className="text-xs text-zinc-500 mb-4 font-mono tabular-nums tracking-tight">
          AWAITING_LIVE_DATA · NEURAL_STREAM_HANDSHAKE…
        </p>
        <div className="h-6 w-48 bg-zinc-700 rounded mb-4 animate-pulse" />
        <div className="h-4 w-full bg-zinc-800 rounded mb-2 animate-pulse" />
        <div className="h-4 w-3/4 bg-zinc-800 rounded animate-pulse" />
      </div>
    );
  }

  const latestNeural =
    logs.length > 0
      ? {
          debate_resolution: logs[0]!.debate_resolution ?? null,
          tech_score: logs[0]!.tech_score ?? null,
          risk_score: logs[0]!.risk_score ?? null,
          psych_score: logs[0]!.psych_score ?? null,
          macro_score: logs[0]!.macro_score ?? null,
          onchain_score: logs[0]!.onchain_score ?? null,
          deep_memory_score: logs[0]!.deep_memory_score ?? null,
          final_confidence: logs[0]!.final_confidence ?? null,
          predicted_direction: logs[0]!.predicted_direction ?? null,
        }
      : null;

  return (
    <section
      className="rounded-2xl border border-amber-500/20 bg-black/40 frosted-obsidian overflow-hidden"
      aria-labelledby="overseer-panel-heading"
    >
      <div className="p-4 sm:p-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <h2 id="overseer-panel-heading" className="flex items-center gap-2 text-lg font-bold text-amber-400">
          <Shield className="w-5 h-5" aria-hidden />
          לוח Supreme Inspector (Overseer)
        </h2>
        <button
          type="button"
          onClick={fetchAll}
          className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden />
          רענן
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-6" dir="rtl">
        <NeuralConsensusVisualizer data={latestNeural} />

        {/* API Health */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-300 mb-3">
            <Activity className="w-4 h-4" aria-hidden />
            סטטוס API
          </h3>
          <div className="flex flex-wrap gap-4">
            {health && (
              <>
                <span className="flex items-center gap-2 text-sm">
                  <StatusIcon status={health.gemini} /> Gemini
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <StatusIcon status={health.groq} /> Groq
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <StatusIcon status={health.pinecone} /> Pinecone
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <StatusIcon status={health.db} /> DB
                </span>
              </>
            )}
          </div>
        </div>

        {/* Global Risk Strictness */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-300 mb-3">
            <Settings className="w-4 h-4" aria-hidden />
            סף סיכון גלובלי (Overseer)
          </h3>
          <form onSubmit={handleSaveStrictness} className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 items-end">
              <span className="text-xs text-zinc-500">סף MoE (ציון קונצנזוס מינימלי)</span>
              <input
                type="number"
                min={50}
                max={95}
                value={moeThreshold}
                onChange={(e) => setMoeThreshold(Number(e.target.value) || 75)}
                className="w-20 rounded-lg bg-zinc-800 border border-white/10 px-2 py-1.5 text-sm text-white text-left"
                dir="ltr"
                aria-label="סף MoE"
              />
            </label>
            <label className="flex flex-col gap-1 items-end">
              <span className="text-xs text-zinc-500">רמת סיכון (R:R)</span>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as 'strict' | 'moderate' | 'aggressive')}
                className="rounded-lg bg-zinc-800 border border-white/10 px-3 py-1.5 text-sm text-white min-w-[8rem]"
                dir="rtl"
                aria-label="רמת סיכון"
              >
                <option value="strict">מחמיר (1:3)</option>
                <option value="moderate">בינוני (1:2)</option>
                <option value="aggressive">אגרסיבי (1:1.5)</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-amber-500/20 border border-amber-500/30 px-4 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </form>
        </div>

        {/* Overseer Logs */}
        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">לוג קונצנזוס אחרון</h3>
          {logs.length === 0 ? (
            <p className="text-sm text-zinc-500">אין עדיין רשומות עם תובנת Overseer.</p>
          ) : (
            <ul className="space-y-3 max-h-64 overflow-y-auto">
              {logs.map((log, i) => (
                <li
                  key={`${log.symbol}-${log.prediction_date}-${i}`}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-medium text-white">{log.symbol}</span>
                    {log.final_confidence != null && (
                      <span
                        className={
                          log.consensus_approved
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }
                      >
                        ציון {log.final_confidence.toFixed(1)}
                      </span>
                    )}
                    <span className="text-zinc-500 text-xs">{log.prediction_date?.slice(0, 10)}</span>
                  </div>
                  {log.master_insight_he && (
                    <p className="text-zinc-400 text-xs leading-relaxed line-clamp-2">
                      {log.master_insight_he.slice(0, 200)}
                      {log.master_insight_he.length > 200 ? '…' : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
