'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Loader2, ChevronDown } from 'lucide-react';

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  action_type: string;
  actor_ip: string | null;
  user_agent: string | null;
  payload_diff: Record<string, unknown> | null;
  created_at: string;
}

export default function SystemAuditTable() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actionType, setActionType] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      if (actionType) params.set('action_type', actionType);
      params.set('limit', '100');
      const res = await fetch(`/api/settings/audit-logs?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data?.logs) setLogs(data.logs);
      else setLogs([]);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, actionType]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="מעקב ביקורת מערכת">
      <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <Shield className="w-5 h-5 text-emerald-400" />
        מעקב ביקורת מערכת (System Audit)
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        פעולות ידניות והגדרות — חיפוש לפי תאריך וסוג פעולה.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-slate-200"
          aria-label="מתאריך"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-slate-200"
          aria-label="עד תאריך"
        />
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-slate-200"
          aria-label="סוג פעולה"
        >
          <option value="">כל הסוגים</option>
          <option value="manual_trade">עסקה ידנית</option>
          <option value="virtual_trade_close">סגירת עסקה וירטואלית</option>
          <option value="settings_update">עדכון הגדרות</option>
        </select>
        <button
          type="button"
          onClick={() => fetchLogs()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          חפש
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>טוען רשומות…</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">לא נמצאו רשומות ביקורת.</div>
        ) : (
          <table className="w-full text-sm text-right" dir="rtl">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-700">
                <th className="px-3 py-2 font-semibold">זמן</th>
                <th className="px-3 py-2 font-semibold">סוג פעולה</th>
                <th className="px-3 py-2 font-semibold">IP</th>
                <th className="px-3 py-2 font-semibold">פרטים</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-slate-700/80 hover:bg-slate-800/60"
                >
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('he-IL')}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-200">{log.action_type}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono text-xs">{log.actor_ip ?? '—'}</td>
                  <td className="px-3 py-2">
                    {log.payload_diff != null && Object.keys(log.payload_diff).length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${expandedId === log.id ? 'rotate-180' : ''}`} />
                        {expandedId === log.id ? 'הסתר' : 'הצג JSON'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {logs.some((l) => expandedId === l.id) && (
        <div className="mt-3 p-3 rounded-lg bg-slate-900/80 border border-slate-700 font-mono text-xs text-slate-300 overflow-x-auto">
          {logs
            .filter((l) => l.id === expandedId)
            .map((l) => (
              <pre key={l.id} dir="ltr" className="whitespace-pre-wrap break-all">
                {JSON.stringify(l.payload_diff, null, 2)}
              </pre>
            ))}
        </div>
      )}
    </section>
  );
}
