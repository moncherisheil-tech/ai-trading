'use client';

import { useEffect, useMemo, useState } from 'react';
import { messages, type Locale } from '@/lib/i18n';
import { normalizeLocale } from '@/lib/locale';

export function useLocale() {
  const [locale, setLocale] = useState<Locale>('he');

  useEffect(() => {
    const sync = () => {
      setLocale(normalizeLocale(document.documentElement.lang, 'he'));
    };

    sync();
    window.addEventListener('locale-change', sync as EventListener);
    return () => window.removeEventListener('locale-change', sync as EventListener);
  }, []);

  const t = useMemo(() => messages[locale], [locale]);
  return { locale, isRtl: locale === 'he', t };
}
