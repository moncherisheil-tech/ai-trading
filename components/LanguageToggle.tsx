'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { LOCALE_COOKIE_KEY, LOCALE_STORAGE_KEY, localeToDir, normalizeLocale } from '@/lib/locale';

export default function LanguageToggle() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'he';
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY), 'he');
  });

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = localeToDir(locale);
    document.cookie = `${LOCALE_COOKIE_KEY}=${locale}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new CustomEvent('locale-change', { detail: locale }));
  }, [locale]);

  const next = useMemo<Locale>(() => (locale === 'en' ? 'he' : 'en'), [locale]);

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      className="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
      aria-label={locale === 'he' ? 'Switch language to English' : 'החלף שפה לעברית'}
    >
      {locale === 'he' ? 'EN' : 'HE'}
    </button>
  );
}
