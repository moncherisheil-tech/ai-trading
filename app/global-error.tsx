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
    console.error(
      '🚨 [Global Error Boundary] Unhandled RSC/render error:',
      '\n  message:', error?.message,
      '\n  digest:', error?.digest,
      '\n  stack:', error?.stack,
    );
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-zinc-200 font-sans">
        {/* Ambient glow */}
        <div
          style={{
            position: 'fixed', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(244,63,94,0.12), transparent 60%)',
          }}
          aria-hidden
        />
        <div className="relative max-w-lg w-full space-y-6 text-center">
          {/* Status badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-rose-400">
            <span
              style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f43f5e', boxShadow: '0 0 8px #f43f5e' }}
              aria-hidden
            />
            System Fault
          </div>

          <div className="rounded-2xl border border-rose-500/20 bg-zinc-900/80 p-8 shadow-2xl space-y-4">
            <h1 className="text-xl font-bold text-zinc-100">תקלה קריטית במערכת</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              אירעה שגיאה בלתי צפויה ב-Server Component. השגיאה נרשמה לטרמינל.
              אנא רענן את הדף. אם הבעיה חוזרת, בדוק את לוגי השרת.
            </p>
            {error?.digest && (
              <p className="text-xs font-mono text-zinc-600 bg-zinc-950/60 rounded-lg px-3 py-2">
                digest: {error.digest}
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-6 py-2.5 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:border-emerald-400/50 hover:bg-emerald-400/15 hover:shadow-[0_0_20px_rgba(52,211,153,0.2)]"
            >
              רענן דף
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
