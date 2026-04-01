'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import type { AppSettings } from '@/lib/db/app-settings';

export type AppTheme = 'dark' | 'light' | 'deep-sea';
export type DataRefreshMinutes = 1 | 5 | 15;

/** Same shape as AppSettings for global consumption (theme, refresh interval, risk, etc.). */
export type AppSettingsPayload = AppSettings | null;

const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

const AppSettingsContext = createContext<{
  settings: AppSettingsPayload;
  refreshIntervalMs: number;
  refreshSettings: () => Promise<void>;
}>({
  settings: null,
  refreshIntervalMs: DEFAULT_REFRESH_MS,
  refreshSettings: async () => {},
});

export function useAppSettings() {
  return useContext(AppSettingsContext);
}

export function useRefreshIntervalMs(): number {
  const { refreshIntervalMs } = useContext(AppSettingsContext);
  return refreshIntervalMs;
}

interface ThemeApplicatorProps {
  children: ReactNode;
}

/**
 * Fetches /api/settings/app on mount and on refreshSettings(), applies theme to document.documentElement,
 * and provides AppSettings to children. Call refreshSettings() after saving to update global state.
 */
export function ThemeApplicator({ children }: ThemeApplicatorProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  const refreshSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/app', { credentials: 'include', cache: 'no-store' });
      const data = res.ok ? (await res.json()) : null;
      setSettings(data);
      const theme = data?.system?.theme ?? 'dark';
      document.documentElement.setAttribute('data-theme', theme);
    } catch {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  useEffect(() => {
    // Skip settings fetch on the login page — user has no auth cookie yet.
    // ThemeApplicator defaults to 'dark', which is the correct login-page theme.
    if (isLoginPage) return;
    const timer = setTimeout(() => {
      void refreshSettings();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshSettings, isLoginPage]);

  const value = useMemo(() => {
    const mins = settings?.system?.dataRefreshIntervalMinutes ?? 5;
    const refreshIntervalMs = mins * 60 * 1000;
    return { settings, refreshIntervalMs, refreshSettings };
  }, [settings, refreshSettings]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
