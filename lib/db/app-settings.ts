/**
 * App-wide settings (trading, risk, neural, notifications, system) stored in settings table.
 * Key: app_settings, Value: JSON. Master Command Center schema.
 */

import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

const KEY = 'app_settings';

export interface AppSettings {
  trading: {
    defaultTradeSizeUsd: number;
    maxOpenPositions: number;
    maxSlippagePct: number;
  };
  risk: {
    defaultStopLossPct: number;
    defaultTakeProfitPct: number;
    defaultPositionSizeUsd: number;
    globalMaxExposurePct: number;
    singleAssetConcentrationLimitPct: number;
    atrMultiplierTp: number;
    atrMultiplierSl: number;
    /** God-Mode: Strict (1:3 R/R), Moderate (1:2), Aggressive (1:1.5). */
    riskToleranceLevel?: 'strict' | 'moderate' | 'aggressive';
  };
  scanner: {
    minVolume24hUsd: number;
    minPriceChangePctForGem: number;
    aiConfidenceThreshold: number;
  };
  neural: {
    moeConfidenceThreshold: number;
    ragEnabled: boolean;
    autoPostMortemEnabled: boolean;
    /** God-Mode: Optional MoE weight overrides (0-1 each; sum 1). E.g. more Macro during news weeks. */
    moeWeightsOverride?: { tech: number; risk: number; psych: number; macro: number };
    /** Per-symbol best expert from last backtest (Deep Memory). When onchain has high accuracy for a symbol, its weight is boosted in CIO. */
    bestExpertBySymbol?: Record<string, { bestExpertKey: string; accuracyPct: number }>;
  };
  notifications: {
    dailyPulseReport: boolean;
    riskCriticalAlerts: boolean;
    newEliteGemDetected: boolean;
  };
  system: {
    telegramNotifications: boolean;
    soundAlerts: boolean;
    theme: 'dark' | 'light' | 'deep-sea';
    dataRefreshIntervalMinutes: 1 | 5 | 15;
    /** Stored in unified `settings` row; runtime may still prefer `TELEGRAM_BOT_TOKEN` env when set. */
    telegramBotToken?: string;
    telegramChatId?: string;
  };
  execution: {
    /** Master kill-switch for autonomous execution (paper/live). */
    masterSwitchEnabled: boolean;
    /** Execution mode: LIVE stays locked until API keys are configured. */
    mode: 'PAPER' | 'LIVE';
    /** Minimum Overseer confidence required for autonomous execution. */
    minConfidenceToExecute: number;
    /** True only when live exchange API credentials are configured and validated. */
    liveApiKeyConfigured: boolean;
    /** CEO Terminal: user confirmed slippage / Kelly / stop-loss checklist before arming LIVE. */
    goLiveSafetyAcknowledged: boolean;
  };
}

/** Default MoE/consensus threshold; single source of truth for fallbacks across codebase. */
export const DEFAULT_MOE_THRESHOLD = 75;

const DEFAULTS: AppSettings = {
  trading: {
    defaultTradeSizeUsd: 100,
    maxOpenPositions: 10,
    maxSlippagePct: 0.5,
  },
  risk: {
    defaultStopLossPct: 5,
    defaultTakeProfitPct: 10,
    defaultPositionSizeUsd: 100,
    globalMaxExposurePct: 70,
    singleAssetConcentrationLimitPct: 20,
    atrMultiplierTp: 4,
    atrMultiplierSl: 2.5,
    riskToleranceLevel: 'strict',
  },
  scanner: {
    minVolume24hUsd: 100_000,
    minPriceChangePctForGem: 2,
    aiConfidenceThreshold: 80,
  },
  neural: {
    moeConfidenceThreshold: DEFAULT_MOE_THRESHOLD,
    ragEnabled: true,
    autoPostMortemEnabled: true,
  },
  notifications: {
    dailyPulseReport: true,
    riskCriticalAlerts: true,
    newEliteGemDetected: true,
  },
  system: {
    telegramNotifications: true,
    soundAlerts: true,
    theme: 'dark',
    dataRefreshIntervalMinutes: 5,
    telegramBotToken: '',
    telegramChatId: '',
  },
  execution: {
    masterSwitchEnabled: true,
    mode: 'PAPER',
    minConfidenceToExecute: 80,
    liveApiKeyConfigured: false,
    goLiveSafetyAcknowledged: false,
  },
};

/** Fallback when `getAppSettings` rejects (e.g. unexpected DB errors in workers). */
export const DEFAULT_APP_SETTINGS: AppSettings = DEFAULTS;

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

const SETTINGS_CACHE_TTL_MS = 3 * 1000; // short cache for near-instant cross-panel propagation
let settingsCache: { data: AppSettings; expiresAt: number } | null = null;

export async function getAppSettings(): Promise<AppSettings> {
  if (!usePostgres()) return DEFAULTS;
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) return settingsCache.data;
  try {
    const { rows } = await sql`
      SELECT value FROM settings WHERE key = ${KEY} LIMIT 1
    `;
    const row = rows?.[0] as { value: unknown } | undefined;
    const raw = row?.value;
    if (raw == null) return DEFAULTS;
    const parsed =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Partial<AppSettings>)
        : (raw as Partial<AppSettings>);
    const merged = deepMergeDefaults(
      DEFAULTS as unknown as Record<string, unknown>,
      parsed as unknown as Record<string, unknown>
    ) as unknown as AppSettings;
    settingsCache = { data: merged, expiresAt: now + SETTINGS_CACHE_TTL_MS };
    return merged;
  } catch {
    return DEFAULTS;
  }
}

export type SetAppSettingsResult = { ok: true } | { ok: false; error: string };

export async function setAppSettings(partial: Partial<AppSettings>): Promise<SetAppSettingsResult> {
  if (!usePostgres()) {
    const msg = 'DATABASE_URL not configured. Set DATABASE_URL in environment.';
    console.error('[SAVE_ERROR] App settings:', msg);
    return { ok: false, error: msg };
  }
  settingsCache = null;
  try {
    const current = await getAppSettings();
    const next = deepMergeDefaults(
      current as unknown as Record<string, unknown>,
      partial as unknown as Record<string, unknown>
    ) as unknown as AppSettings;
    const value = JSON.stringify(next);
    await sql`
      INSERT INTO settings (id, key, value, "updatedAt")
      VALUES (${randomUUID()}, ${KEY}, ${value}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = ${value}::jsonb,
        "updatedAt" = NOW()
    `;
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[SAVE_ERROR] App settings', e);
    return { ok: false, error: message };
  }
}

function deepMergeDefaults<T extends Record<string, unknown>>(base: T, partial: Partial<T>): T {
  const out = { ...base };
  for (const k of Object.keys(partial) as (keyof T)[]) {
    const v = partial[k];
    if (v === undefined) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && typeof base[k] === 'object' && base[k] !== null) {
      (out as Record<string, unknown>)[k as string] = deepMergeDefaults(
        base[k] as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      (out as Record<string, unknown>)[k as string] = v;
    }
  }
  return out;
}
