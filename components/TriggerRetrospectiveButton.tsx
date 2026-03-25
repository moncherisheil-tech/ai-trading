'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

type TriggerRetrospectiveButtonProps = {
  label: string;
};

type ToastState = { type: 'success'; message: string } | { type: 'error'; message: string } | null;

export default function TriggerRetrospectiveButton({ label }: TriggerRetrospectiveButtonProps) {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const handleClick = async () => {
    setLoading(true);
    setToast(null);
    try {
      const res = await fetch('/api/ops/trigger-retrospective', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setToast({ type: 'success', message: 'מחזור הלמידה הושלם בהצלחה. הדוח נשלח לטלגרם.' });
      } else {
        setToast({ type: 'error', message: json?.error ?? 'הפעולה נכשלה' });
      }
    } catch {
      setToast({ type: 'error', message: 'שגיאת רשת או שרת' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-busy={loading}
        aria-label={loading ? 'מריץ מחזור למידה…' : label}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 text-sm font-medium text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/30 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-amber-500/10 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111] min-h-[44px] touch-manipulation"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden />
            <span>מריץ…</span>
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
            <span>{label}</span>
          </>
        )}
      </button>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
