'use client';

import Link from 'next/link';

const DISCLAIMER_TEXT =
  'המידע המוצג במערכת זו נוצר על ידי בינה מלאכותית ומיועד למטרות לימוד וסימולציה בלבד. אין לראות במידע זה ייעוץ השקעות, המלצה לפעולה או תחליף לייעוץ פיננסי מקצועי. המסחר במטבעות קריפטוגרפיים כרוך בסיכון גבוה.';

export default function LegalDisclaimer() {
  return (
    <div
      className="mt-auto border-t border-white/5 bg-[#0a0a0a] py-4 px-4 sm:px-6"
      role="contentinfo"
      aria-label="תנאים משפטיים והבהרות"
    >
      <div className="max-w-7xl mx-auto space-y-3" dir="rtl">
        <p
          className="text-xs sm:text-sm text-zinc-500 leading-relaxed max-w-4xl"
          lang="he"
        >
          {DISCLAIMER_TEXT}
        </p>
        <nav
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500"
          aria-label="קישורים משפטיים"
        >
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-amber-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] rounded transition-colors"
          >
            תקנון שימוש
          </Link>
          <span className="text-zinc-600" aria-hidden>
            |
          </span>
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-amber-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] rounded transition-colors"
          >
            מדיניות פרטיות
          </Link>
          <span className="text-zinc-600" aria-hidden>
            |
          </span>
          <Link
            href="/risk"
            className="underline underline-offset-2 hover:text-amber-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] rounded transition-colors"
          >
            אזהרת סיכון
          </Link>
        </nav>
      </div>
    </div>
  );
}
