'use client';

import { useEffect, useMemo, useState } from 'react';
import { messages, type Locale } from '@/lib/i18n';

export function useLocale() {
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    const sync = () => {
      const lang = document.documentElement.lang === 'he' ? 'he' : 'en';
      setLocale(lang);
    };

    sync();
    window.addEventListener('locale-change', sync as EventListener);
    return () => window.removeEventListener('locale-change', sync as EventListener);
  }, []);

  const t = useMemo(() => messages[locale], [locale]);
  return { locale, t };
}
