/**
 * GET: Read app settings (Master Command Center).
 * POST: Update app settings. Requires valid Admin Session when session enabled.
 * Validates types (numbers, 0–100% where applicable), logs payload_diff to audit_logs.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';
import {
  getAppSettings,
  getAppSettingsUpdatedAt,
  setAppSettings,
  type AppSettings,
} from '@/lib/db/app-settings';
import { recordAuditLog } from '@/lib/db/audit-logs';

export const dynamic = 'force-dynamic';

function clampNum(value: unknown, min: number, max: number, defaultVal: number): number {
  const n = typeof value === 'number' && !Number.isNaN(value) ? value : Number(value);
  if (Number.isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

function clampPct(value: unknown, defaultVal: number): number {
  return clampNum(value, 0, 100, defaultVal);
}

/** Validate and normalize incoming body so numbers are not stored as strings; percentages 0–100. */
function validateAndNormalize(body: Record<string, unknown>): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  if (body.trading && typeof body.trading === 'object' && !Array.isArray(body.trading)) {
    const t = body.trading as Record<string, unknown>;
    out.trading = {
      defaultTradeSizeUsd: Math.max(10, Math.min(1_000_000, Number(t.defaultTradeSizeUsd) || 100)),
      maxOpenPositions: Math.max(1, Math.min(100, Math.floor(Number(t.maxOpenPositions) || 10))),
      maxSlippagePct: clampPct(t.maxSlippagePct, 0.5),
    };
  }
  if (body.risk && typeof body.risk === 'object' && !Array.isArray(body.risk)) {
    const r = body.risk as Record<string, unknown>;
    const level = r.riskToleranceLevel;
    const riskToleranceLevel =
      level === 'strict' || level === 'moderate' || level === 'aggressive' ? level : undefined;
    const riskPart: Record<string, unknown> = {};
    if (r.defaultStopLossPct !== undefined) riskPart.defaultStopLossPct = clampPct(r.defaultStopLossPct, 5);
    if (r.defaultTakeProfitPct !== undefined) riskPart.defaultTakeProfitPct = clampPct(r.defaultTakeProfitPct, 10);
    if (r.defaultPositionSizeUsd !== undefined) riskPart.defaultPositionSizeUsd = Math.max(10, Math.min(1_000_000, Number(r.defaultPositionSizeUsd) || 100));
    if (r.globalMaxExposurePct !== undefined) riskPart.globalMaxExposurePct = clampPct(r.globalMaxExposurePct, 70);
    if (r.singleAssetConcentrationLimitPct !== undefined) riskPart.singleAssetConcentrationLimitPct = clampPct(r.singleAssetConcentrationLimitPct, 20);
    if (r.atrMultiplierTp !== undefined) riskPart.atrMultiplierTp = Math.max(0.5, Math.min(20, Number(r.atrMultiplierTp) || 4));
    if (r.atrMultiplierSl !== undefined) riskPart.atrMultiplierSl = Math.max(0.5, Math.min(20, Number(r.atrMultiplierSl) || 2.5));
    if (riskToleranceLevel) riskPart.riskToleranceLevel = riskToleranceLevel;
    if (Object.keys(riskPart).length) out.risk = riskPart as AppSettings['risk'];
  }
  if (body.scanner && typeof body.scanner === 'object' && !Array.isArray(body.scanner)) {
    const s = body.scanner as Record<string, unknown>;
    out.scanner = {
      minVolume24hUsd: Math.max(0, Number(s.minVolume24hUsd) || 100_000),
      minPriceChangePctForGem: clampPct(s.minPriceChangePctForGem, 2),
      aiConfidenceThreshold: clampPct(s.aiConfidenceThreshold, 80),
    };
  }
  if (body.neural && typeof body.neural === 'object' && !Array.isArray(body.neural)) {
    const n = body.neural as Record<string, unknown>;
    const neuralPart: Record<string, unknown> = {};
    if (n.moeConfidenceThreshold !== undefined) neuralPart.moeConfidenceThreshold = clampPct(n.moeConfidenceThreshold, 75);
    if (n.llmTemperature !== undefined) {
      neuralPart.llmTemperature = clampNum(n.llmTemperature, 0, 2, 0.2);
    }
    if (n.ragEnabled !== undefined) neuralPart.ragEnabled = typeof n.ragEnabled === 'boolean' ? n.ragEnabled : Boolean(n.ragEnabled);
    if (n.autoPostMortemEnabled !== undefined) neuralPart.autoPostMortemEnabled = typeof n.autoPostMortemEnabled === 'boolean' ? n.autoPostMortemEnabled : Boolean(n.autoPostMortemEnabled);
    if (Object.keys(neuralPart).length) out.neural = neuralPart as AppSettings['neural'];
  }
  if (body.notifications && typeof body.notifications === 'object' && !Array.isArray(body.notifications)) {
    const n = body.notifications as Record<string, unknown>;
    out.notifications = {
      dailyPulseReport: typeof n.dailyPulseReport === 'boolean' ? n.dailyPulseReport : Boolean(n.dailyPulseReport),
      riskCriticalAlerts: typeof n.riskCriticalAlerts === 'boolean' ? n.riskCriticalAlerts : Boolean(n.riskCriticalAlerts),
      newEliteGemDetected: typeof n.newEliteGemDetected === 'boolean' ? n.newEliteGemDetected : Boolean(n.newEliteGemDetected),
    };
  }
  if (body.system && typeof body.system === 'object' && !Array.isArray(body.system)) {
    const s = body.system as Record<string, unknown>;
    const theme = s.theme;
    const validTheme = theme === 'dark' || theme === 'light' || theme === 'deep-sea' ? theme : undefined;
    const systemPart: Record<string, unknown> = {
      telegramNotifications: typeof s.telegramNotifications === 'boolean' ? s.telegramNotifications : Boolean(s.telegramNotifications),
      soundAlerts: typeof s.soundAlerts === 'boolean' ? s.soundAlerts : Boolean(s.soundAlerts),
      theme: validTheme,
      dataRefreshIntervalMinutes: [1, 5, 15].includes(Number(s.dataRefreshIntervalMinutes)) ? (Number(s.dataRefreshIntervalMinutes) as 1 | 5 | 15) : undefined,
    };
    if (s.telegramBotToken !== undefined) {
      const t = typeof s.telegramBotToken === 'string' ? s.telegramBotToken.trim() : '';
      if (t.length <= 4096) systemPart.telegramBotToken = t;
    }
    if (s.telegramChatId !== undefined) {
      const c = typeof s.telegramChatId === 'string' ? s.telegramChatId.trim() : '';
      if (c === '' || /^-?\d{1,20}$/.test(c)) systemPart.telegramChatId = c;
    }
    out.system = systemPart as AppSettings['system'];
    if ((out.system as Record<string, unknown>).theme === undefined) delete (out.system as Record<string, unknown>).theme;
    if ((out.system as Record<string, unknown>).dataRefreshIntervalMinutes === undefined) delete (out.system as Record<string, unknown>).dataRefreshIntervalMinutes;
  }
  if (body.execution && typeof body.execution === 'object' && !Array.isArray(body.execution)) {
    const e = body.execution as Record<string, unknown>;
    const mode = e.mode === 'PAPER' || e.mode === 'LIVE' ? e.mode : undefined;
    const executionPart: Record<string, unknown> = {};
    if (e.masterSwitchEnabled !== undefined) {
      executionPart.masterSwitchEnabled =
        typeof e.masterSwitchEnabled === 'boolean' ? e.masterSwitchEnabled : Boolean(e.masterSwitchEnabled);
    }
    if (mode) executionPart.mode = mode;
    if (e.minConfidenceToExecute !== undefined) {
      executionPart.minConfidenceToExecute = clampPct(e.minConfidenceToExecute, 80);
    }
    if (e.liveApiKeyConfigured !== undefined) {
      executionPart.liveApiKeyConfigured =
        typeof e.liveApiKeyConfigured === 'boolean' ? e.liveApiKeyConfigured : Boolean(e.liveApiKeyConfigured);
    }
    if (e.goLiveSafetyAcknowledged !== undefined) {
      executionPart.goLiveSafetyAcknowledged =
        typeof e.goLiveSafetyAcknowledged === 'boolean'
          ? e.goLiveSafetyAcknowledged
          : Boolean(e.goLiveSafetyAcknowledged);
    }
    if (Object.keys(executionPart).length) out.execution = executionPart as AppSettings['execution'];
  }
  return out as Partial<AppSettings>;
}

/** Build a shallow diff of only changed keys (for audit). */
function payloadDiff(current: AppSettings, next: AppSettings): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  const keys: (keyof AppSettings)[] = ['trading', 'risk', 'scanner', 'neural', 'notifications', 'system', 'execution'];
  for (const top of keys) {
    const cur = current[top] as Record<string, unknown> | undefined;
    const nxt = next[top] as Record<string, unknown> | undefined;
    if (!nxt) continue;
    const sub: Record<string, unknown> = {};
    for (const k of Object.keys(nxt)) {
      const c = cur && typeof cur[k] !== 'undefined' ? cur[k] : undefined;
      const n = nxt[k];
      if (JSON.stringify(c) !== JSON.stringify(n)) sub[k] = n;
    }
    if (Object.keys(sub).length) diff[top] = sub;
  }
  return diff;
}

const SECRET_SYSTEM_KEYS = new Set(['telegramBotToken', 'telegramChatId']);

/** Never persist raw Telegram secrets in audit_logs. */
function redactPayloadDiffForAudit(diff: Record<string, unknown>): Record<string, unknown> {
  const system = diff.system;
  if (!system || typeof system !== 'object' || Array.isArray(system)) return diff;
  const sub = { ...(system as Record<string, unknown>) };
  let changed = false;
  for (const k of SECRET_SYSTEM_KEYS) {
    if (k in sub) {
      sub[k] = '[redacted]';
      changed = true;
    }
  }
  if (!changed) return diff;
  return { ...diff, system: sub };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session) {
      console.warn('[API settings/app GET] 401 Unauthorized: missing or invalid session token.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const includeMeta = request.nextUrl.searchParams.get('includeMeta') === '1';
  try {
    const settings = await getAppSettings();
    if (includeMeta) {
      const updatedAt = await getAppSettingsUpdatedAt();
      return NextResponse.json({ settings, meta: { updatedAt } });
    }
    return NextResponse.json(settings);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load settings';
    console.error('[SETTINGS_ERROR] settings/app GET', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let actorRole: string | null = null;
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      console.warn('[API settings/app POST] 401 Unauthorized: missing session or not admin.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    actorRole = session.role;
  } else if (isDevelopmentAuthBypass()) {
    actorRole = 'dev_bypass';
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const normalized = validateAndNormalize(body);
    if (Object.keys(normalized).length === 0) {
      const current = await getAppSettings();
      return NextResponse.json({ ok: true, settings: current });
    }
    const current = await getAppSettings();
    const result = await setAppSettings(normalized);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'Failed to update settings' },
        { status: 503 }
      );
    }
    const updated = await getAppSettings();
    const diff = payloadDiff(current, updated);
    const safePatch = Object.keys(diff).length ? redactPayloadDiffForAudit(diff) : { updated: true };
    await recordAuditLog({
      action_type: 'settings_update',
      actor_ip: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
      payload_diff: { patch: safePatch, actorRole },
    });
    revalidatePath('/settings');
    revalidatePath('/');
    return NextResponse.json({ ok: true, settings: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save settings';
    console.error('[SAVE_ERROR] settings/app POST', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
