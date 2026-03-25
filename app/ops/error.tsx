'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';

export default function OpsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Ops Error Boundary]', error?.message ?? error);
  }, [error]);

  return (
    <div className="min-h-[320px] flex flex-col items-center justify-center p-8 bg-zinc-900/95 border border-zinc-700/80 rounded-xl text-center" dir="rtl">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
        <AlertTriangle className="w-7 h-7" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-zinc-100 mb-2">שגיאה בלוח הבקרה</h2>
      <p className="text-sm text-zinc-400 max-w-md mb-6">
        אירעה תקלה בטעינת הדף. ניתן לנסות שוב או לחזור ללוח הבקרה.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          נסה שוב
        </button>
        <Link
          href="/ops"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors"
        >
          <LayoutDashboard className="w-4 h-4" />
          חזרה ללוח
        </Link>
      </div>
    </div>
  );
}
