'use client';

import { useEffect, useMemo } from 'react';
import { messages, type Locale } from '@/lib/i18n';
import { LOCALE_COOKIE_KEY, LOCALE_STORAGE_KEY } from '@/lib/locale';

/** Product UI is Hebrew-only (RTL). Document lang/dir are locked on mount. */
export function useLocale() {
  useEffect(() => {
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'he');
      document.cookie = `${LOCALE_COOKIE_KEY}=he; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
  }, []);

  const t = useMemo(() => messages.he, []);
  return { locale: 'he' as const satisfies Locale, isRtl: true, t };
}
