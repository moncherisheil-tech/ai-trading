'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n';

const STORAGE_KEY = 'app-locale';

export default function LanguageToggle() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'he';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'he' || stored === 'en' ? stored : 'he';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
    window.dispatchEvent(new CustomEvent('locale-change', { detail: locale }));
  }, [locale]);

  const next = useMemo<Locale>(() => (locale === 'en' ? 'he' : 'en'), [locale]);

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      className="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
      aria-label="החלף שפה"
    >
      {locale === 'en' ? 'עברית' : 'English'}
    </button>
  );
}
