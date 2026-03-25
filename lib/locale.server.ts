import { cookies } from 'next/headers';
import type { Locale } from '@/lib/i18n';
import { LOCALE_COOKIE_KEY, normalizeLocale } from '@/lib/locale';

export async function getRequestLocale(): Promise<Locale> {
  try {
    const jar = await cookies();
    return normalizeLocale(jar.get(LOCALE_COOKIE_KEY)?.value, 'he');
  } catch {
    return 'he';
  }
}

