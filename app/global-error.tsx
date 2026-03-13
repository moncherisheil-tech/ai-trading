'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Error Boundary]', error?.message ?? error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-200 font-sans">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold text-slate-100">תקלה במערכת</h1>
          <p className="text-sm text-slate-400">
            אירעה שגיאה בלתי צפויה. אנא רענן את הדף או נסה שוב מאוחר יותר.
          </p>
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium"
          >
            רענן דף
          </button>
        </div>
      </body>
    </html>
  );
}
