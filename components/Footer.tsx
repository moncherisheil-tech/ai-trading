'use client';

import Link from 'next/link';

const FINANCIAL_DISCLAIMER =
  'מסחר כרוך בסיכון גבוה. מערכת זו מיועדת למטרות חינוכיות וניתוחיות בלבד — אינה ייעוץ השקעות או המלצה לפעולה. כל החלטה מסחרית על אחריותך.';

export default function Footer() {
  return (
    <footer
      className="sticky bottom-0 start-0 end-0 z-[var(--z-header)] border-t border-white/10 bg-[#0a0a0a]/98 backdrop-blur-sm py-3 px-4 sm:px-6"
      role="contentinfo"
      aria-label="תנאים משפטיים והבהרת סיכון"
    >
      <div className="max-w-7xl mx-auto space-y-2" dir="rtl">
        <p
          className="text-xs text-amber-500/95 font-medium leading-snug text-center sm:text-right max-w-4xl"
          lang="he"
        >
          {FINANCIAL_DISCLAIMER}
        </p>
        <nav
          className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-xs text-zinc-500"
          aria-label="קישורים משפטיים"
        >
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-amber-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded transition-colors"
          >
            תנאי שימוש
          </Link>
          <span className="text-zinc-600" aria-hidden>|</span>
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-amber-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded transition-colors"
          >
            מדיניות פרטיות
          </Link>
          <span className="text-zinc-600" aria-hidden>|</span>
          <Link
            href="/risk"
            className="underline underline-offset-2 hover:text-amber-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded transition-colors"
          >
            אזהרת סיכון
          </Link>
        </nav>
      </div>
    </footer>
  );
}
