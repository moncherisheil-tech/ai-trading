'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Error Boundary]', error?.message ?? error);
  }, [error]);

  return (
    <div className="min-h-[280px] flex flex-col items-center justify-center p-6 bg-slate-900/95 border border-slate-700/80 rounded-xl text-center" dir="rtl">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
        <AlertTriangle className="w-7 h-7" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-slate-100 mb-2">שגיאה בהצגת הדף</h2>
      <p className="text-sm text-slate-400 max-w-md mb-6">
        אירעה תקלה. ניתן לנסות שוב או לחזור ללוח הבקרה.
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        נסה שוב
      </button>
    </div>
  );
}
