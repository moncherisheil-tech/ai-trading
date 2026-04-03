'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Profile Error Boundary]', error?.message ?? error);
  }, [error]);

  return (
    <div
      className="min-h-[320px] flex flex-col items-center justify-center p-8 rounded-2xl border border-amber-500/30 bg-amber-950/20 text-center"
      dir="rtl"
      role="alert"
    >
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
        <AlertTriangle className="w-7 h-7" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-slate-100 mb-2">פרופיל אינו זמין</h2>
      <p className="text-sm text-slate-400 max-w-md mb-6">
        לא ניתן לטעון את נתוני הפרופיל. נסה שוב בעוד מספר שניות.
      </p>
      {error?.message ? (
        <p className="text-xs text-zinc-500 font-mono break-all max-w-md mb-6" dir="ltr">
          {error.message}
        </p>
      ) : null}
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
