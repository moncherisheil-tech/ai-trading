import { cookies } from 'next/headers';
import type { Locale } from '@/lib/i18n';

export const LOCALE_STORAGE_KEY = 'app-locale';
export const LOCALE_COOKIE_KEY = 'app-locale';

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'he' || value === 'en';
}

export function normalizeLocale(value: string | null | undefined, fallback: Locale = 'he'): Locale {
  return isLocale(value) ? value : fallback;
}

export function localeToDir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr';
}

export async function getRequestLocale(): Promise<Locale> {
  const jar = await cookies();
  return normalizeLocale(jar.get(LOCALE_COOKIE_KEY)?.value, 'he');
}
