/**
 * UQE — מסוף טלגרם מאוחד: תפריט קבוע, הגדרות, אותות אלפא מקצועיים.
 * כל מחרוזות המשתמש בעברית; מזהי callback קצרים (מגבלת 64 בתים).
 */
import type { AlphaTimeframe } from '@prisma/client';
import { APP_CONFIG, getBaseUrl } from '@/lib/config';
import { getAppSettings, setAppSettings } from '@/lib/db/app-settings';
import { setStrategyOverride } from '@/lib/db/prediction-weights';
import { getPrisma } from '@/lib/prisma';
import type { AlphaSignalDTO } from '@/lib/alpha-signals-db';
import { getLatestActiveAlphaSignalsFromDb } from '@/lib/alpha-signals-db';
import { escapeHtml, sendTelegramMessage, sendTelegramRaw, type TelegramReplyMarkup } from '@/lib/telegram';
import { executeAutonomousConsensusSignal } from '@/lib/trading/execution-engine';

/** callback_data: ax:SYMBOL:H|D|W|L */
export const ALPHA_EXEC_CALLBACK_PREFIX = 'ax:';

/** callback_data: set:risk:con|agg | set:notif:on|off */
export const SETTINGS_CB_PREFIX = 'set:';

export const MENU_BUTTON_TO_COMMAND: Record<string, string> = {
  '🤖 מצב רובוט': '/robot',
  '📈 אותות אלפא': '/alpha',
  '🎓 מרכז למידה': '/academy',
  '⚙️ הגדרות': '/settings',
};

export const UNIFIED_MAIN_MENU_KEYBOARD: string[][] = [
  ['🤖 מצב רובוט', '📈 אותות אלפא'],
  ['🎓 מרכז למידה', '⚙️ הגדרות'],
];

export function resolveMenuOrCommandText(raw: string): string {
  const t = (raw || '').trim();
  return MENU_BUTTON_TO_COMMAND[t] ?? t;
}

export function getUnifiedReplyKeyboardMarkup(): TelegramReplyMarkup {
  return {
    keyboard: UNIFIED_MAIN_MENU_KEYBOARD.map((row) => row.map((label) => ({ text: label }))),
    resize_keyboard: true,
  };
}

function getToken(): string {
  return typeof process.env.TELEGRAM_BOT_TOKEN === 'string' ? process.env.TELEGRAM_BOT_TOKEN.trim() : '';
}

function safeAppRoot(): string {
  const base = getBaseUrl().replace(/\/$/, '');
  return base.startsWith('http://localhost')
    ? (process.env.NEXT_PUBLIC_APP_URL || 'https://quantum-mon-cheri.com').replace(/\/$/, '')
    : base;
}

function tfCodeFromTimeframe(tf: string): 'H' | 'D' | 'W' | 'L' | null {
  switch (tf) {
    case 'Hourly':
      return 'H';
    case 'Daily':
      return 'D';
    case 'Weekly':
      return 'W';
    case 'Long':
      return 'L';
    default:
      return null;
  }
}

function timeframeFromCode(code: string): AlphaTimeframe | null {
  const c = code.toUpperCase();
  const m: Record<string, AlphaTimeframe> = {
    H: 'Hourly',
    D: 'Daily',
    W: 'Weekly',
    L: 'Long',
  };
  return m[c] ?? null;
}

function timeframeLabelHe(tf: string): string {
  switch (tf) {
    case 'Hourly':
      return 'שעתי';
    case 'Daily':
      return 'יומי';
    case 'Weekly':
      return 'שבועי';
    case 'Long':
      return 'ארוך טווח';
    default:
      return tf;
  }
}

function directionHe(d: string): string {
  return d === 'Short' ? 'שורט' : 'לונג';
}

function strengthEmojis(p: number): string {
  const x = Math.max(0, Math.min(100, Math.round(p)));
  if (x >= 82) return '🔥🔥🔥';
  if (x >= 64) return '🔥🔥';
  if (x >= 45) return '🔥';
  return '◽';
}

function riskRewardAscii(entry: number, target: number, stop: number, direction: string): string {
  if (!Number.isFinite(entry) || entry <= 0) return 'יחס סיכון/תגמול: —';
  const risk =
    direction === 'Short' ? Math.abs(stop - entry) : Math.abs(entry - stop);
  const reward =
    direction === 'Short' ? Math.abs(entry - target) : Math.abs(target - entry);
  if (!Number.isFinite(risk) || risk <= 0) return 'יחס סיכון/תגמול: —';
  const rr = reward / risk;
  const bars = 10;
  const riskBars = Math.max(1, Math.round((1 / (1 + rr)) * bars));
  const rewardBars = Math.max(1, bars - riskBars);
  const riskStr = '█'.repeat(riskBars) + '░'.repeat(bars - riskBars);
  const rewStr = '█'.repeat(rewardBars) + '░'.repeat(bars - rewardBars);
  return `סיכון [${riskStr}] : תגמול [${rewStr}]\nיחס 1 : ${rr.toFixed(2)}`;
}

function buildAlphaExecCallback(symbol: string, code: 'H' | 'D' | 'W' | 'L'): string {
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${ALPHA_EXEC_CALLBACK_PREFIX}${clean}:${code}`.slice(0, 64);
}

/** הודעת HTML + כפתורי ביצוע לכל אופק */
export function formatAlphaSymbolTelegramHtml(rows: AlphaSignalDTO[]): { text: string; reply_markup: TelegramReplyMarkup } {
  const sym = rows[0]?.symbol ?? '';
  const header = `⚡ <b>אות אלפא — ${escapeHtml(sym)}</b>\n<i>מטריצת טרי־קור · מסד חי</i>\n`;
  const blocks: string[] = [];
  const keyboard: Array<Array<{ text: string; callback_data?: string }>> = [];

  const order = ['Hourly', 'Daily', 'Weekly', 'Long'];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.timeframe) - order.indexOf(b.timeframe));

  for (const r of sorted) {
    const code = tfCodeFromTimeframe(r.timeframe);
    const em = strengthEmojis(r.winProbability);
    const rr = riskRewardAscii(r.entryPrice, r.targetPrice, r.stopLoss, r.direction);
    blocks.push(
      [
        `${em} <b>${escapeHtml(timeframeLabelHe(r.timeframe))}</b> · ${escapeHtml(directionHe(r.direction))} · ${r.winProbability}%`,
        `<code>כניסה ${r.entryPrice.toFixed(4)}</code> · יעד <code>${r.targetPrice.toFixed(4)}</code> · סטופ <code>${r.stopLoss.toFixed(4)}</code>`,
        whaleLine(r.whaleConfirmation),
        `<pre>${escapeHtml(rr)}</pre>`,
      ].join('\n')
    );
    if (code) {
      keyboard.push([
        {
          text: `בצע עכשיו · ${timeframeLabelHe(r.timeframe)}`,
          callback_data: buildAlphaExecCallback(r.symbol, code),
        },
      ]);
    }
  }

  const text = header + '\n\n' + blocks.join('\n\n—\n\n');
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

function whaleLine(ok: boolean): string {
  return ok ? '🐋 <b>אישור לווייתנים:</b> כן' : '⚪ <b>אישור לווייתנים:</b> לא';
}

export async function recordRobotHandshakeTelegram(): Promise<void> {
  if (!APP_CONFIG.postgresUrl?.trim()) return;
  const cur = await getAppSettings();
  await setAppSettings({
    system: {
      ...cur.system,
      robotHandshakeAt: new Date().toISOString(),
      robotHandshakeSource: 'telegram',
    },
  });
}

export async function buildRobotStatusMessageHe(): Promise<string> {
  const settings = await getAppSettings();
  const ex = settings.execution;
  const auto = ex.masterSwitchEnabled ? 'פעיל' : 'כבוי (פיקוח ידני)';
  const mode = ex.mode === 'LIVE' ? 'מסחר חי' : 'נייר (סימולציה)';
  const at = settings.system?.robotHandshakeAt
    ? new Date(settings.system.robotHandshakeAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const src =
    settings.system?.robotHandshakeSource === 'dashboard'
      ? 'לוח פיקוד'
      : settings.system?.robotHandshakeSource === 'telegram'
        ? 'טלגרם'
        : '—';
  return [
    '🤖 <b>מצב רובוט ביצוע</b>',
    '',
    `מנוע אוטונומי: <b>${auto}</b>`,
    `מצב ארנק: <b>${mode}</b>`,
    `סף ביטחון לביצוע: <b>${ex.minConfidenceToExecute ?? 80}%</b>`,
    '',
    `סנכרון אחרון: <b>${escapeHtml(at)}</b> (${escapeHtml(src)})`,
    '',
    '<i>המידע לתפעול וסימולציה בלבד.</i>',
  ].join('\n');
}

export function buildAcademyTelegramMessageHe(): string {
  const root = safeAppRoot();
  const url = `${root}/academy#glossary-dxy`;
  return [
    '🎓 <b>מרכז הלמידה</b>',
    '',
    `פתחו באפליקציה: <a href="${escapeHtml(url)}">אקדמיית Mon Chéri</a>`,
    '',
    'מילון מונחים, ניהול סיכונים, והסבר על מומחי ה־MoE.',
  ].join('\n');
}

export function buildSettingsInlineKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'סיכון · שמרני', callback_data: `${SETTINGS_CB_PREFIX}risk:con` },
        { text: 'סיכון · אגרסיבי', callback_data: `${SETTINGS_CB_PREFIX}risk:agg` },
      ],
      [
        { text: 'התראות · מופעל', callback_data: `${SETTINGS_CB_PREFIX}notif:on` },
        { text: 'התראות · כבוי', callback_data: `${SETTINGS_CB_PREFIX}notif:off` },
      ],
    ],
  };
}

export async function applyTelegramSettingsCallback(data: string): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ נדרש חיבור למסד נתונים לעדכון הגדרות.';
  }
  const cur = await getAppSettings();
  if (data === `${SETTINGS_CB_PREFIX}risk:con`) {
    await setStrategyOverride(90, 'טלגרם: מצב שמרני');
    await setAppSettings({
      risk: { ...cur.risk, riskToleranceLevel: 'strict' },
    });
    return '✅ רמת סיכון הוגדרה ל־<b>שמרני</b> (סף 90%).';
  }
  if (data === `${SETTINGS_CB_PREFIX}risk:agg`) {
    await setStrategyOverride(75, 'טלגרם: מצב אגרסיבי');
    await setAppSettings({
      risk: { ...cur.risk, riskToleranceLevel: 'aggressive' },
    });
    return '✅ רמת סיכון הוגדרה ל־<b>אגרסיבי</b> (סף 75%).';
  }
  if (data === `${SETTINGS_CB_PREFIX}notif:on`) {
    await setAppSettings({ system: { ...cur.system, telegramNotifications: true } });
    return '✅ <b>התראות טלגרם</b> הופעלו.';
  }
  if (data === `${SETTINGS_CB_PREFIX}notif:off`) {
    await setAppSettings({ system: { ...cur.system, telegramNotifications: false } });
    return '✅ <b>התראות טלגרם</b> כובו.';
  }
  return 'פעולה לא מוכרת.';
}

function toNum(d: unknown): number {
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  if (d && typeof d === 'object' && 'toNumber' in d && typeof (d as { toNumber: () => number }).toNumber === 'function') {
    return (d as { toNumber: () => number }).toNumber();
  }
  return Number(d);
}

export async function telegramExecuteAlphaSignal(
  symbolRaw: string,
  tfCode: string
): Promise<{ ok: boolean; messageHe: string }> {
  const clean = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const symbol = clean.endsWith('USDT') ? clean : `${clean}USDT`;
  const timeframe = timeframeFromCode(tfCode);
  if (!timeframe) return { ok: false, messageHe: 'אופק לא תקין.' };

  const prisma = getPrisma();
  if (!prisma) return { ok: false, messageHe: 'מסד נתונים לא זמין.' };

  const row = await prisma.alphaSignalRecord.findFirst({
    where: { symbol, status: 'Active', timeframe },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) return { ok: false, messageHe: 'לא נמצא אות פעיל לסמל ואופק זה.' };

  const side = row.direction === 'Short' ? 'SELL' : 'BUY';
  const confidence = row.winProbability;
  const idempotencyKey = `tg-ax-${row.id}-${Math.floor(Date.now() / 25000)}`;

  const result = await executeAutonomousConsensusSignal({
    predictionId: `alpha-row-${row.id}`,
    idempotencyKey,
    priority: 'standard',
    symbol,
    predictedDirection: side === 'BUY' ? 'Bullish' : 'Bearish',
    finalConfidence: confidence,
    consensusApproved: true,
    consensusReasoning: {
      overseerSummary: `אישור מטלגרם · אות אלפא · ${timeframeLabelHe(row.timeframe)} · ${side}`,
      overseerReasoningPath: 'telegram_alpha_inline',
      expertBreakdown: {
        source: 'telegram_alpha',
        alphaSignalId: row.id,
        timeframe: row.timeframe,
        side,
        entry: toNum(row.entryPrice),
        target: toNum(row.targetPrice),
        stop: toNum(row.stopLoss),
      },
    },
  });

  if (result.status === 'executed' && result.executed) {
    await recordRobotHandshakeTelegram();
    return { ok: true, messageHe: '✅ הבקשה נקלטה במרכז הביצועים (TWAP/סימולציה).' };
  }
  if (result.status === 'blocked') {
    return { ok: false, messageHe: '⏸ הביצוע נחסם (מנוע כבוי או סף ביטחון).' };
  }
  return { ok: false, messageHe: `⚠️ לא בוצע: ${escapeHtml((result.reason || '').slice(0, 180))}` };
}

/** שליחת אותות אלפא למנויים לאחר סריקה (אם התראות מופעלות). */
export async function broadcastAlphaScanToTelegram(symbol: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  const settings = await getAppSettings();
  if (!settings.system.telegramNotifications) return;

  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pair = sym.endsWith('USDT') ? sym : `${sym}USDT`;
  const all = await getLatestActiveAlphaSignalsFromDb(120);
  const rows = all.filter((r) => r.symbol === pair);
  if (rows.length === 0) return;

  const { text, reply_markup } = formatAlphaSymbolTelegramHtml(rows);
  await sendTelegramMessage(text, { parse_mode: 'HTML', reply_markup });
}

/** שליחת כל האותות הפעילים (פקודת /alpha). */
export async function sendAllActiveAlphaSignalsToTelegram(): Promise<string> {
  const token = getToken();
  if (!token) return '❌ בוט טלגרם לא מוגדר.';
  const all = await getLatestActiveAlphaSignalsFromDb(120);
  if (all.length === 0) return '📈 <b>אותות אלפא</b>\n\nאין רשומות פעילות כרגע.';

  const bySym = new Map<string, AlphaSignalDTO[]>();
  for (const r of all) {
    const list = bySym.get(r.symbol) ?? [];
    list.push(r);
    bySym.set(r.symbol, list);
  }

  for (const [, rows] of bySym) {
    const { text, reply_markup } = formatAlphaSymbolTelegramHtml(rows);
    await sendTelegramMessage(text, { parse_mode: 'HTML', reply_markup });
  }
  return `📈 נשלחו אותות עבור <b>${bySym.size}</b> סמלים.`;
}

export async function sendTelegramWithUnifiedMenu(
  chatId: string | number,
  text: string,
  options?: { parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2'; reply_markup?: TelegramReplyMarkup }
): Promise<void> {
  const token = getToken();
  if (!token) return;
  await sendTelegramRaw({
    token,
    chatId: String(chatId),
    text,
    parse_mode: options?.parse_mode ?? 'HTML',
    reply_markup: options?.reply_markup ?? getUnifiedReplyKeyboardMarkup(),
  });
}
