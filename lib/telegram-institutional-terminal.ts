/**
 * INSTITUTIONAL FLOOR 1000 — Telegram executive SPA terminal.
 * Single dashboard message: editMessageText / editMessageReplyMarkup only.
 * ACL: Telegram user id must match DB admin (or TELEGRAM_ADMIN_CHAT_ID when DB off).
 */

import { APP_CONFIG } from '@/lib/config';
import { getMacroPulse } from '@/lib/macro-service';
import { getCachedGemsTicker24h } from '@/lib/cache-service';
import { getScannerState } from '@/lib/workers/market-scanner';
import { countScannerAlertsToday } from '@/lib/db/scanner-alert-log';
import {
  getVirtualPortfolioSummary,
  listOpenTrades,
  closeAllOpenVirtualTradesAtMarket,
} from '@/lib/simulation-service';
import { getAppSettings, setAppSettings, type AppSettings } from '@/lib/db/app-settings';
import { isChatIdActiveAdmin } from '@/lib/db/telegram-subscribers';
import { recordAuditLog } from '@/lib/db/audit-logs';
import { editTelegramMessage } from '@/lib/telegram';
import { DEFAULT_WEIGHTS, setWeights } from '@/lib/db/prediction-weights';
import { getLiveInfraHealth, type DatabaseProbeStatus } from '@/lib/infra-health-probes';

export const INSTITUTIONAL_FLOOR_CB_PREFIX = 'ifl:';

/** Audit action_type for all terminal-side effects (DB logging). */
export const EXEC_TERMINAL_AUDIT = 'EXEC-TERMINAL-ACTION';

const SESSION_TTL_SEC = 5 * 60;
const LOCK_SCAN = 'hawk_scan';

/** In-memory action locks (debounce / concurrent block). Keyed by `${userId}:${scope}`. */
const busy = new Map<string, boolean>();

function lockKey(userId: number, scope: string): string {
  return `${userId}:${scope}`;
}

async function withTerminalLock<T>(
  userId: number,
  scope: string,
  fn: () => Promise<T>
): Promise<T | 'locked'> {
  const k = lockKey(userId, scope);
  if (busy.get(k)) return 'locked';
  busy.set(k, true);
  try {
    return await fn();
  } finally {
    busy.delete(k);
  }
}

function getAdminChatIdEnv(): string {
  const c = process.env.TELEGRAM_ADMIN_CHAT_ID;
  return typeof c === 'string' ? c.trim() : '';
}

/** Strict admin: DB role admin when Postgres configured; else env TELEGRAM_ADMIN_CHAT_ID === userId. */
export async function isInstitutionalTerminalAdmin(telegramUserId: number | undefined): Promise<boolean> {
  if (telegramUserId == null) return false;
  const id = String(telegramUserId);
  if (APP_CONFIG.postgresUrl?.trim()) {
    return isChatIdActiveAdmin(id);
  }
  const admin = getAdminChatIdEnv();
  return admin !== '' && id === admin;
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Wrap content in MarkdownV2 monospace block (```). */
export function monoBlock(lines: string[]): string {
  const inner = lines.join('\n');
  return '```\n' + inner + '\n```';
}

function fmtPct(n: number, width = 12): string {
  const s = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  return s.padStart(width);
}

function fmtUsd(n: number, width = 14): string {
  const s =
    n >= 0
      ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '-$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s.padStart(width);
}

function parseCallbackData(data: string): string {
  if (!data.startsWith(INSTITUTIONAL_FLOOR_CB_PREFIX)) return '';
  return data.slice(INSTITUTIONAL_FLOOR_CB_PREFIX.length);
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '💼 תיק ורווח/הפסד', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}p` },
        { text: '🦅 Hawk-Eye', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}h` },
      ],
      [
        { text: '🧠 לוח מומחים', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}n` },
        { text: '🛡️ סיכון ובקרה', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}k` },
      ],
    ],
  };
}

function backRow() {
  return [{ text: '⬅️ ראשי', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}m` }];
}

function portfolioKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 רענון תיק', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}pr` }],
      backRow(),
    ],
  };
}

function hawkKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⚡ סריקת מצב', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}fs` },
        { text: '🎯 מצב צלף', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}sn` },
      ],
      backRow(),
    ],
  };
}

function neuralKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⚖️ איפוס משקלים', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}fc` }],
      backRow(),
    ],
  };
}

function riskKeyboard(settings: { mode: string; pendingToggle?: boolean; pendingHard?: boolean }) {
  if (settings.pendingToggle) {
    return {
      inline_keyboard: [
        [
          { text: '✅ אשר החלפת מצב', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}ty` },
          { text: '⬅️ ביטול', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}k` },
        ],
      ],
    };
  }
  if (settings.pendingHard) {
    return {
      inline_keyboard: [
        [
          { text: '✅ אשר ניקוי מלא', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}hy` },
          { text: '⬅️ ביטול', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}k` },
        ],
      ],
    };
  }
  const modeLabel = settings.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
  return {
    inline_keyboard: [
      [{ text: `🔄 החלף מצב: ${modeLabel} ⇄ ${modeLabel === 'LIVE' ? 'SHADOW' : 'LIVE'}`, callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}wt` }],
      [{ text: '🟡 עצירה רכה', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}sk` }],
      [{ text: '🔴 ניקוי שוק (מכירה)', callback_data: `${INSTITUTIONAL_FLOOR_CB_PREFIX}wh` }],
      backRow(),
    ],
  };
}

async function auditTerminalAction(payload: Record<string, unknown>): Promise<void> {
  try {
    await recordAuditLog({
      action_type: EXEC_TERMINAL_AUDIT,
      actor_ip: null,
      user_agent: 'telegram-institutional-terminal',
      payload_diff: payload,
    });
  } catch {
    /* non-fatal */
  }
}

function databaseProbeLabel(s: DatabaseProbeStatus): string {
  switch (s) {
    case 'ok':
      return 'תקין';
    case 'absent':
      return 'חסר';
    case 'misconfigured':
      return 'כתובת שגויה';
    case 'unreachable':
      return 'לא זמין';
    default:
      return 'לא ידוע';
  }
}

async function buildMainText(): Promise<string> {
  const [settings, health] = await Promise.all([getAppSettings(), getLiveInfraHealth()]);
  const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
  const apiOk = (on: boolean) => (on ? 'תקין' : 'לא זמין');
  const lines = [
    '*מסוף מוסדי — Mon Chéri Quant*',
    'מרכז פיקוד ניהולי',
    '',
    monoBlock([
      'סשן'.padEnd(16) + 'OK',
      'מצב ביצוע'.padEnd(16) + mode.padEnd(8),
      'מתג ראשי'.padEnd(16) + (settings.execution.masterSwitchEnabled ? 'דלוק' : 'כבוי'),
      'PostgreSQL'.padEnd(16) + databaseProbeLabel(health.database),
      'Gemini API'.padEnd(16) + apiOk(health.gemini),
      'Groq API'.padEnd(16) + apiOk(health.groq),
    ]),
  ];
  return lines.join('\n');
}

async function buildPortfolioText(): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '*💼 תיק*\n\n' + monoBlock(['DB לא זמין', 'הגדר DATABASE_URL']);
  }
  const [summary, open] = await Promise.all([getVirtualPortfolioSummary(), listOpenTrades()]);
  const longUsd = open.reduce((s, t) => s + t.amount_usd, 0);
  const table = [
    'מדד'.padEnd(18) + 'ערך',
    '-'.repeat(32),
    'תשואה יומית %'.padEnd(18) + fmtPct(summary.dailyPnlPct, 10).trimStart(),
    'חשיפה $'.padEnd(18) + fmtUsd(summary.totalInvestedUsd, 12).trimStart(),
    'ספר'.padEnd(18) + 'סימולציה לונג',
    'נומינל לונג $'.padEnd(18) + fmtUsd(longUsd, 12).trimStart(),
    'פוזיציות פתוחות'.padEnd(18) + String(summary.openCount),
    'אחוז הצלחה %'.padEnd(18) + summary.winRatePct.toFixed(2),
  ];
  return ['*💼 תיק ורווח/הפסד*', '', monoBlock(table)].join('\n');
}

async function buildNeuralText(settings: AppSettings): Promise<string> {
  const baseW = { tech: 0.25, risk: 0.25, psych: 0.25, macro: 0.25 };
  const o = settings.neural.moeWeightsOverride;
  const w = { ...baseW, ...(o ?? {}) };
  const entries = Object.entries(w).map(([k, v]) => ({ k, v: Number(v) }));
  entries.sort((a, b) => b.v - a.v);
  const top = entries.slice(0, 3);
  const labels: Record<string, string> = {
    tech: 'טכני',
    risk: 'סיכון',
    psych: 'פסיכולוגיה',
    macro: 'מאקרו',
  };
  const table = [
    'מומחה'.padEnd(14) + 'משקל %',
    '-'.repeat(24),
    ...top.map((e) => (labels[e.k] ?? e.k).padEnd(14) + (e.v * 100).toFixed(2).padStart(8)),
  ];
  return ['*🧠 לוח מומחים*', '', 'שלושת המובילים \\(לפי משקל\\):', '', monoBlock(table)].join('\n');
}

function sessionExpiredMessage(): string {
  return '🔒 פג תוקף המסוף\\. שלח /terminal לפתיחה מחדש\\.';
}

function isMessageExpired(messageDateUnix: number | undefined): boolean {
  if (messageDateUnix == null) return false;
  const now = Math.floor(Date.now() / 1000);
  return now - messageDateUnix > SESSION_TTL_SEC;
}

export interface TerminalWebhookContext {
  token: string;
  callbackQueryId: string;
  fromUserId: number;
  chatId: number;
  messageId: number;
  messageDateUnix?: number;
  data: string;
}

export type TerminalHandleResult =
  | { kind: 'silent' }
  | { kind: 'not_terminal' }
  | { kind: 'ok' };

/**
 * Handle institutional floor callbacks. Caller must not invoke for non-admin users.
 * Unauthorized callers: handle at webhook with silent drop before calling.
 */
export async function handleInstitutionalTerminalCallback(ctx: TerminalWebhookContext): Promise<TerminalHandleResult> {
  const action = parseCallbackData(ctx.data);
  if (!action) return { kind: 'not_terminal' };

  const { token, chatId, messageId, messageDateUnix, fromUserId } = ctx;

  if (isMessageExpired(messageDateUnix)) {
    await editTelegramMessage({
      token,
      chatId: String(chatId),
      messageId,
      text: sessionExpiredMessage(),
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: [] },
    });
    await auditTerminalAction({ step: 'session_expired', message_id: messageId });
    return { kind: 'ok' };
  }

  const chatIdStr = String(chatId);

  switch (action) {
    case 'm': {
      const text = await buildMainText();
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: mainKeyboard(),
      });
      await auditTerminalAction({ action: 'main_menu', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'p': {
      const text = await buildPortfolioText();
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: portfolioKeyboard(),
      });
      await auditTerminalAction({ action: 'view_portfolio', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'pr': {
      const locked = await withTerminalLock(fromUserId, 'pr', async () => {
        const text = await buildPortfolioText();
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: portfolioKeyboard(),
        });
        await auditTerminalAction({ action: 'refresh_ledger', user_id: fromUserId });
      });
      if (locked === 'locked') {
        await auditTerminalAction({ action: 'refresh_ledger_blocked', user_id: fromUserId, reason: 'concurrent' });
      }
      return { kind: 'ok' };
    }
    case 'h': {
      const text =
        '*🦅 Hawk\\-Eye Ops*\n\n' +
        monoBlock(['Flash Scan  : market snapshot', 'Sniper Mode : single\\-asset focus']) +
        '\n_Select an operation\\._';
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: hawkKeyboard(),
      });
      await auditTerminalAction({ action: 'hawk_menu', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'fs': {
      const result = await withTerminalLock(fromUserId, LOCK_SCAN, async () => {
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text: '*🦅 Hawk\\-Eye*\n\n_Scanning\\.\\.\\._',
          parse_mode: 'MarkdownV2',
          reply_markup: hawkKeyboard(),
        });
        const [macro, scanner, tickers, alertsToday] = await Promise.all([
          getMacroPulse(),
          Promise.resolve(getScannerState()),
          getCachedGemsTicker24h({
            minVolume24hUsd: 500_000,
            minLiquidityUsd: 50_000,
            minPriceChangePct: 1,
          }),
          APP_CONFIG.postgresUrl?.trim() ? countScannerAlertsToday() : Promise.resolve(0),
        ]);
        const sorted = [...tickers]
          .filter((t) => t.symbol?.endsWith('USDT'))
          .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0))
          .slice(0, 8);
        const rows = [
          'Symbol'.padEnd(10) + 'Chg%'.padStart(10) + 'Vol$M'.padStart(12),
          '-'.repeat(34),
          ...sorted.map((t) => {
            const base = (t.symbol || '').replace('USDT', '').slice(0, 8);
            const chg = t.priceChangePercent ?? 0;
            const volM = ((t.quoteVolume ?? 0) / 1e6).toFixed(2);
            return base.padEnd(10) + fmtPct(chg, 10).trimStart().padStart(10) + volM.padStart(12);
          }),
          '',
          'Scanner: ' + scanner.status + ' | Alerts today: ' + alertsToday,
          'F&G: ' + macro.fearGreedIndex + ' | BTC dom: ' + macro.btcDominancePct + '%',
        ];
        const text =
          '*⚡ Flash Scan* — complete\n\n' +
          monoBlock(rows) +
          '\n_' +
          escapeMarkdownV2(scanner.lastDiagnostics?.summaryWhenZeroGems?.slice(0, 120) || 'Snapshot from cache + scanner state.') +
          '_';
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: hawkKeyboard(),
        });
        await auditTerminalAction({ action: 'flash_scan', user_id: fromUserId });
      });
      if (result === 'locked') {
        await auditTerminalAction({ action: 'flash_scan_blocked', user_id: fromUserId, reason: 'concurrent' });
      }
      return { kind: 'ok' };
    }
    case 'sn': {
      const result = await withTerminalLock(fromUserId, LOCK_SCAN, async () => {
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text: '*🎯 Sniper Mode*\n\n_Scoping target\\.\\.\\._',
          parse_mode: 'MarkdownV2',
          reply_markup: hawkKeyboard(),
        });
        const tickers = await getCachedGemsTicker24h({
          minVolume24hUsd: 500_000,
          minLiquidityUsd: 50_000,
          minPriceChangePct: 0,
        });
        const sorted = [...tickers]
          .filter((t) => t.symbol?.endsWith('USDT') && t.priceChangePercent != null)
          .sort(
            (a, b) =>
              Math.abs(b.priceChangePercent ?? 0) - Math.abs(a.priceChangePercent ?? 0)
          );
        const t = sorted[0];
        const base = t ? (t.symbol || '').replace('USDT', '') : '—';
        const px = t?.price ?? 0;
        const chg = t?.priceChangePercent ?? 0;
        const rows = [
          'Target'.padEnd(12) + base,
          'Last'.padEnd(12) + (px > 0 ? px.toFixed(4) : '—'),
          '24h Move %'.padEnd(12) + chg.toFixed(2),
          'Focus'.padEnd(12) + 'Highest abs move',
        ];
        const text =
          '*🎯 Sniper Mode*\n\n' +
          monoBlock(rows) +
          '\n_Precision focus on top mover \\(24h\\)\\._';
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: hawkKeyboard(),
        });
        await auditTerminalAction({ action: 'sniper_mode', user_id: fromUserId, symbol: t?.symbol });
      });
      if (result === 'locked') {
        await auditTerminalAction({ action: 'sniper_mode_blocked', user_id: fromUserId, reason: 'concurrent' });
      }
      return { kind: 'ok' };
    }
    case 'n': {
      const settings = await getAppSettings();
      const text = await buildNeuralText(settings);
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: neuralKeyboard(),
      });
      await auditTerminalAction({ action: 'neural_board', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'fc': {
      const locked = await withTerminalLock(fromUserId, 'fc', async () => {
        await setWeights(DEFAULT_WEIGHTS, 'Institutional Terminal force re-calibration');
        const cur = await getAppSettings();
        await setAppSettings({
          neural: {
            ...cur.neural,
            moeWeightsOverride: undefined,
          },
        });
        const settings = await getAppSettings();
        const text = await buildNeuralText(settings);
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text:
            text +
            '\n\n✅ *Re\\-calibration applied* \\(weights reset to defaults\\)\\.',
          parse_mode: 'MarkdownV2',
          reply_markup: neuralKeyboard(),
        });
        await auditTerminalAction({ action: 'force_recalibration', user_id: fromUserId });
      });
      if (locked === 'locked') {
        await auditTerminalAction({ action: 'recalibration_blocked', user_id: fromUserId });
      }
      return { kind: 'ok' };
    }
    case 'k': {
      const settings = await getAppSettings();
      const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
      const text =
        '*🛡️ Risk & Control*\n\n' +
        monoBlock([
          'Mode'.padEnd(18) + mode,
          'Master Switch'.padEnd(18) + (settings.execution.masterSwitchEnabled ? 'ON' : 'OFF'),
        ]) +
        '\n_Zero\\-trust actions below\\._';
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: riskKeyboard({ mode }),
      });
      await auditTerminalAction({ action: 'risk_menu', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'wt': {
      const settings = await getAppSettings();
      const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
      const next = mode === 'LIVE' ? 'SHADOW' : 'LIVE';
      const text =
        '*⚠️ Confirm mode toggle*\n\n' +
        monoBlock([
          'Current '.padEnd(14) + mode,
          'Next    '.padEnd(14) + next,
        ]) +
        '\n_Are you sure\\? This changes execution mode\\._';
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: riskKeyboard({ mode, pendingToggle: true }),
      });
      await auditTerminalAction({ action: 'toggle_mode_confirm', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'ty': {
      const locked = await withTerminalLock(fromUserId, 'toggle', async () => {
        const cur = await getAppSettings();
        const nextMode: 'PAPER' | 'LIVE' = cur.execution.mode === 'LIVE' ? 'PAPER' : 'LIVE';
        await setAppSettings({
          execution: {
            ...cur.execution,
            mode: nextMode,
          },
        });
        const settings = await getAppSettings();
        const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
        const text =
          '*🛡️ Risk & Control*\n\n' +
          monoBlock(['Mode updated'.padEnd(18) + mode]) +
          '\n_Toggle complete\\._';
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: riskKeyboard({ mode }),
        });
        await auditTerminalAction({ action: 'toggle_mode', user_id: fromUserId, mode: nextMode });
      });
      if (locked === 'locked') {
        await auditTerminalAction({ action: 'toggle_blocked', user_id: fromUserId });
      }
      return { kind: 'ok' };
    }
    case 'sk': {
      const locked = await withTerminalLock(fromUserId, 'sk', async () => {
        const cur = await getAppSettings();
        await setAppSettings({
          execution: { ...cur.execution, masterSwitchEnabled: false },
        });
        const settings = await getAppSettings();
        const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
        const text =
          '*🟡 SOFT KILL*\n\n' +
          monoBlock(['New positions'.padEnd(18) + 'BLOCKED', 'Master Switch'.padEnd(18) + 'OFF']) +
          '\n_Autonomous opening disabled\\._';
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: riskKeyboard({ mode }),
        });
        await auditTerminalAction({ action: 'soft_kill', user_id: fromUserId });
      });
      if (locked === 'locked') {
        await auditTerminalAction({ action: 'soft_kill_blocked', user_id: fromUserId });
      }
      return { kind: 'ok' };
    }
    case 'wh': {
      const settings = await getAppSettings();
      const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
      const text =
        '*🔴 HARD KILL*\n\n' +
        monoBlock(['Action'.padEnd(18) + 'LIQUIDATE ALL', 'Price'.padEnd(18) + 'MARKET']) +
        '\n_This will close every open virtual position at market\\. Confirm\\?_';
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: riskKeyboard({ mode, pendingHard: true }),
      });
      await auditTerminalAction({ action: 'hard_kill_confirm', user_id: fromUserId });
      return { kind: 'ok' };
    }
    case 'hy': {
      const locked = await withTerminalLock(fromUserId, 'hk', async () => {
        const curMode = (await getAppSettings()).execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text: '*🔴 HARD KILL*\n\n_Liquidating at market\\.\\.\\._',
          parse_mode: 'MarkdownV2',
          reply_markup: riskKeyboard({ mode: curMode }),
        });
        const { closed, errors } = await closeAllOpenVirtualTradesAtMarket();
        const cur = await getAppSettings();
        await setAppSettings({
          execution: { ...cur.execution, masterSwitchEnabled: false },
        });
        const settings = await getAppSettings();
        const mode = settings.execution.mode === 'LIVE' ? 'LIVE' : 'SHADOW';
        const rows = [
          'Positions closed'.padEnd(20) + String(closed),
          'Errors'.padEnd(20) + String(errors.length),
        ];
        if (errors.length) {
          rows.push(...errors.slice(0, 4).map((e) => e.slice(0, 36)));
        }
        const text =
          '*🔴 HARD KILL — complete*\n\n' +
          monoBlock(rows) +
          '\n_Master Switch OFF\\. No new risk until re\\-armed\\._';
        await editTelegramMessage({
          token,
          chatId: chatIdStr,
          messageId,
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: riskKeyboard({ mode }),
        });
        await auditTerminalAction({
          action: 'hard_kill_liquidate',
          user_id: fromUserId,
          closed,
          error_count: errors.length,
        });
      });
      if (locked === 'locked') {
        await auditTerminalAction({ action: 'hard_kill_blocked', user_id: fromUserId });
      }
      return { kind: 'ok' };
    }
    default: {
      const text = await buildMainText();
      await editTelegramMessage({
        token,
        chatId: chatIdStr,
        messageId,
        text,
        parse_mode: 'MarkdownV2',
        reply_markup: mainKeyboard(),
      });
      await auditTerminalAction({ action: 'unknown_ifl_callback', user_id: fromUserId, raw: action });
      return { kind: 'ok' };
    }
  }
}

/** Opening message for /terminal (send new message). */
export async function buildTerminalDashboardText(): Promise<string> {
  return buildMainText();
}

export function getTerminalDashboardKeyboard() {
  return mainKeyboard();
}
