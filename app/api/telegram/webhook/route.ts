/**
 * Telegram Webhook: Interactive Command Center + callback buttons.
 * All user-facing text in RTL Hebrew. Use "הנהלה" and "אלגוריתם" — no personal names.
 *
 * CRITICAL: This route MUST be reachable by Telegram servers without browser cookies,
 * session, or CSRF. Middleware only protects /ops, so /api/* is not blocked.
 * Authentication: when PostgreSQL is configured, only `telegram_subscribers` rows with
 * `is_active` may invoke commands/callbacks (DB ACL). Without Postgres, TELEGRAM_CHAT_ID /
 * TELEGRAM_ADMIN_CHAT_ID env fallbacks apply for local/dev continuity.
 */

import { NextRequest, NextResponse } from 'next/server';

/** Ensure webhook is never statically optimized; no auth/cookie checks. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { openVirtualTrade } from '@/lib/simulation-service';
import {
  GEM_CALLBACK_PREFIX_CONFIRM,
  GEM_CALLBACK_PREFIX_REJECT,
  sendTelegramRaw,
} from '@/lib/telegram';
import {
  performDeepAnalysis,
  buildDeepReportMessage,
} from '@/lib/deep-analysis-service';
import { insertDeepAnalysisLog } from '@/lib/db/deep-analysis-logs';
import { getLatestPredictionIdBySymbol } from '@/lib/db/historical-predictions';
import { getMacroPulse } from '@/lib/macro-service';
import { getScannerState } from '@/lib/workers/market-scanner';
import { countScannerAlertsToday } from '@/lib/db/scanner-alert-log';
import {
  getVirtualPortfolioSummary,
  listOpenTrades,
  listClosedTrades,
} from '@/lib/simulation-service';
import {
  setStrategyOverride,
  getStrategyOverride,
} from '@/lib/db/prediction-weights';
import { isSupportedBase } from '@/lib/symbols';
import { APP_CONFIG } from '@/lib/config';
import { escapeHtml } from '@/lib/telegram';
import { getOverseerChatReply } from '@/lib/system-overseer';
import { recordAuditLog } from '@/lib/db/audit-logs';
import { getAppSettings, setAppSettings } from '@/lib/db/app-settings';
import { listVirtualTradeHistory } from '@/lib/db/virtual-trades-history';
import {
  isChatIdActiveSubscriber,
  isChatIdActiveAdmin,
} from '@/lib/db/telegram-subscribers';
import {
  INSTITUTIONAL_FLOOR_CB_PREFIX,
  handleInstitutionalTerminalCallback,
  isInstitutionalTerminalAdmin,
  buildTerminalDashboardText,
  getTerminalDashboardKeyboard,
  EXEC_TERMINAL_AUDIT,
} from '@/lib/telegram-institutional-terminal';
import {
  ALPHA_EXEC_CALLBACK_PREFIX,
  SETTINGS_CB_PREFIX,
  applyTelegramSettingsCallback,
  buildAcademyTelegramMessageHe,
  buildRobotStatusMessageHe,
  buildSettingsInlineKeyboard,
  getUnifiedReplyKeyboardMarkup,
  recordRobotHandshakeTelegram,
  resolveMenuOrCommandText,
  sendAllActiveAlphaSignalsToTelegram,
  telegramExecuteAlphaSignal,
} from '@/lib/telegram-bot';

const TELEGRAM_API = 'https://api.telegram.org';

/** Telegram Update: message (commands) and/or callback_query (buttons). */
interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { id?: number };
    date?: number;
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number }; message_id?: number; date?: number };
  };
}

function getToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return typeof t === 'string' ? t.trim() : '';
}

function getDefaultChatId(): string {
  const c = process.env.TELEGRAM_CHAT_ID;
  return typeof c === 'string' ? c.trim() : '';
}

/** CEO Executive Hotline: only this chat gets Overseer AI replies. Set TELEGRAM_ADMIN_CHAT_ID in .env. */
function getAdminChatId(): string {
  const c = process.env.TELEGRAM_ADMIN_CHAT_ID;
  return typeof c === 'string' ? c.trim() : '';
}

/** Legacy env allow-list when Postgres / `telegram_subscribers` is not used. */
function isAllowedChatIdFromEnv(chatId: number | string | undefined): boolean {
  const defaultId = getDefaultChatId();
  const adminId = getAdminChatId();
  if (!defaultId && !adminId) return false;
  const id = String(chatId);
  return id === defaultId || (adminId !== '' && id === adminId);
}

/** DB-backed ACL when Postgres is configured; otherwise env-based allow-list. */
async function isAllowedChatAsync(chatId: number | string | undefined): Promise<boolean> {
  if (chatId == null) return false;
  const id = String(chatId);
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return isAllowedChatIdFromEnv(id);
  }
  return isChatIdActiveSubscriber(id);
}

/** Returns true only if the chat is the CEO Executive Hotline (TELEGRAM_ADMIN_CHAT_ID). Used to gate Overseer AI when DB has no admin row. */
function isAdminChatIdFromEnv(chatId: number | string | undefined): boolean {
  const adminId = getAdminChatId();
  if (!adminId) return false;
  return String(chatId) === adminId;
}

/** Overseer: active `admin` row in DB, or TELEGRAM_ADMIN_CHAT_ID when set. */
async function isAdminChatAsync(chatId: number | string | undefined): Promise<boolean> {
  if (chatId == null) return false;
  const id = String(chatId);
  if (APP_CONFIG.postgresUrl?.trim()) {
    const dbAdmin = await isChatIdActiveAdmin(id);
    if (dbAdmin) return true;
  }
  return isAdminChatIdFromEnv(chatId);
}

async function sendToChat(chatId: string | number, text: string): Promise<void> {
  const token = getToken();
  if (!token || !String(chatId)) return;
  await sendTelegramRaw({
    token,
    chatId: String(chatId),
    text,
    parse_mode: 'HTML',
  });
}

/** Parse text command: /cmd or /cmd arg */
function parseCommand(text: string): { cmd: string; arg: string } {
  const t = (text || '').trim();
  const firstSpace = t.indexOf(' ');
  if (firstSpace < 0) {
    const cmd = t.startsWith('/') ? t.slice(1).toLowerCase() : '';
    return { cmd, arg: '' };
  }
  const cmd = t.startsWith('/') ? t.slice(1, firstSpace).toLowerCase() : t.slice(0, firstSpace).toLowerCase();
  const arg = t.slice(firstSpace + 1).trim();
  return { cmd, arg };
}

/** /start — קבלת פנים + תפריט קבוע (UQE) */
function handleStart(): string {
  return [
    '💎 <b>קוואנטום מון שרי — מסוף פיקוד מאוחד</b>',
    '',
    'ברוכים הבאים. התפריט הקבוע למטה מסנכרן את הרובוט, אותות אלפא, האקדמיה וההגדרות.',
    '',
    'ניתן עדיין להקליד פקודות ישירות (למשל <code>/status</code>, <code>/halt</code>, <code>/help</code>).',
    '',
    '<i>לתפעול וסימולציה בלבד — לא ייעוץ השקעות.</i>',
  ].join('\n');
}

/** /status — Simulation Wallet summary (Balance, Win Rate, Daily PnL) + Macro + Scanner */
async function handleStatus(): Promise<string> {
  const [summary, macro, scanner, gemsToday] = await Promise.all([
    APP_CONFIG.postgresUrl?.trim() ? getVirtualPortfolioSummary() : Promise.resolve(null),
    getMacroPulse(),
    Promise.resolve(getScannerState()),
    APP_CONFIG.postgresUrl?.trim() ? countScannerAlertsToday() : Promise.resolve(0),
  ]);
  const parts = [
    '📊 <b>סטטוס מערכת — מרכז פקודות</b>',
    '',
    '<b>💼 ארנק סימולציה (וירטואלי)</b>',
  ];
  if (summary != null) {
    parts.push(
      `• <b>מאזן (רווח/הפסד מצטבר):</b> <code>${summary.totalVirtualBalancePct >= 0 ? '+' : ''}${summary.totalVirtualBalancePct.toFixed(2)}%</code>`,
      `• <b>אחוז הצלחה:</b> <code>${summary.winRatePct.toFixed(1)}%</code>`,
      `• <b>רווח/הפסד יומי:</b> <code>${summary.dailyPnlPct >= 0 ? '+' : ''}${summary.dailyPnlPct.toFixed(2)}%</code>`,
      `• פוזיציות פתוחות: ${summary.openCount} | סגורות: ${summary.closedCount}`,
      ''
    );
  } else {
    parts.push('• ארנק סימולציה: לא זמין (חיבור DB נדרש)', '');
  }
  const statusHe = scanner.status === 'ACTIVE' ? 'פעיל' : 'ממתין';
  const lastScan = scanner.lastScanTime
    ? new Date(scanner.lastScanTime).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  parts.push(
    '<b>מאקרו (פחד ותאווה / דומיננטיות BTC):</b>',
    `• מדד פחד ותאווה: ${macro.fearGreedIndex} (${macro.fearGreedClassification})`,
    `• דומיננטיות BTC: ${macro.btcDominancePct}%`,
    `• אסטרטגיה: ${macro.strategyLabelHe}`,
    '',
    '<b>סורק השוק (אלגוריתם):</b>',
    `• סטטוס: ${statusHe}`,
    `• סריקה אחרונה: ${lastScan}`,
    `• ג\'מים היום: ${gemsToday}`
  );
  if (scanner.lastRunStats) {
    parts.push(
      '',
      `• נסרקו: ${scanner.lastRunStats.coinsChecked} | נמצאו: ${scanner.lastRunStats.gemsFound} | התראות נשלחו: ${scanner.lastRunStats.alertsSent}`
    );
  }
  const fx = macro.forexUplink;
  if (fx) {
    parts.push(
      '',
      '<b>מדד דולר ושערי חליפין:</b>',
      `<pre>מדד דולר: ${fx.dxy != null ? fx.dxy.toFixed(2) : '—'}
יורו/דולר: ${fx.eurUsd != null ? fx.eurUsd.toFixed(4) : '—'}
דולר/שקל: ${fx.usdIls != null ? fx.usdIls.toFixed(3) : '—'}</pre>`,
      escapeHtml(fx.ilsRiskNoteHe)
    );
  }
  return parts.join('\n');
}

/** /halt — emergency: master execution switch OFF (הנהלה). */
async function handleHalt(): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ עצירת חירום דורשת חיבור ל־Quantum Core DB (DATABASE_URL).';
  }
  const cur = await getAppSettings();
  const res = await setAppSettings({
    execution: { ...cur.execution, masterSwitchEnabled: false },
  });
  if (!res.ok) {
    return `❌ עצירת חירום נכשלה: ${escapeHtml(res.error)}`;
  }
  return '🛑 <b>עצירת חירום הופעלה</b>\nביצוע אוטונומי כובה (Master Switch OFF). הנהלה יכולה להדליק שוב ממרכז הפקודות.';
}

/** /brief — last-hour execution log summary (monospace). */
async function handleBrief(): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ תקציר שעה דורש חיבור ל־Quantum Core DB.';
  }
  const rows = await listVirtualTradeHistory(150);
  const since = Date.now() - 60 * 60 * 1000;
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= since);
  const lines = [
    '⏱ <b>תקציר שעה אחרונה — ביצועים</b>',
    `<pre>אירועים: ${recent.length}</pre>`,
  ];
  for (const r of recent.slice(0, 12)) {
    const side = r.signal_side === 'BUY' ? 'BUY ' : 'SELL';
    const st = r.execution_status;
    lines.push(
      `<pre>${escapeHtml(r.symbol)} ${side}| ${st} | ${r.executed ? 'EXEC' : '—'} | conf ${Number(r.confidence).toFixed(1)}
${escapeHtml((r.reason ?? '').slice(0, 120))}</pre>`
    );
  }
  if (recent.length === 0) {
    lines.push('<pre>אין רישומי ביצוע בשעה האחרונה.</pre>');
  }
  return lines.join('\n\n');
}

/** /report — Executive summary of last 5 closed trades */
async function handleReport(): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ דוח עסקאות דורש חיבור ל־Quantum Core DB (DATABASE_URL).';
  }
  const closed = await listClosedTrades(5);
  if (closed.length === 0) {
    return '📋 <b>דוח מנהלים — 5 עסקאות אחרונות</b>\n\nאין עדיין עסקאות סגורות בתיק הסימולציה.';
  }
  const lines = [
    '📋 <b>דוח מנהלים — 5 עסקאות אחרונות</b>',
    '',
    'סיכום טקסטואלי להנהלה:',
    '',
  ];
  for (const t of closed) {
    const base = t.symbol.replace('USDT', '');
    const pnl = t.pnl_pct != null ? `${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%` : '—';
    const reason = t.close_reason === 'take_profit' ? 'רווח' : t.close_reason === 'stop_loss' ? 'סטופ' : t.close_reason === 'manual' ? 'ידני' : t.close_reason ?? '—';
    lines.push(`• <b>${escapeHtml(base)}</b> — כניסה <code>$${t.entry_price.toLocaleString()}</code> → יציאה <code>$${(t.exit_price ?? 0).toLocaleString()}</code> | PnL: <code>${pnl}</code> (${reason})`);
  }
  return lines.join('\n');
}

/** /analyze [SYMBOL] — Deep analysis for a coin. Validates symbol. */
async function handleAnalyze(symbolArg: string): Promise<string> {
  if (!symbolArg) {
    return '❌ נא לציין סימבול. דוגמה: <code>/analyze BTC</code> או <code>/analyze ETH</code>';
  }
  const raw = symbolArg.toUpperCase().replace(/\s/g, '');
  const base = raw.endsWith('USDT') ? raw.slice(0, -4) : raw;
  if (!base) {
    return '❌ סימבול לא תקין.';
  }
  if (!isSupportedBase(base)) {
    return `❌ הסימבול "${base}" אינו ברשימת הנכסים הנתמכים. נא לנסות BTC, ETH, SOL וכו\'.`;
  }
  const symbol = base + 'USDT';
  try {
    const result = await performDeepAnalysis(symbol);
    const predictionId = await getLatestPredictionIdBySymbol(symbol);
    if (APP_CONFIG.postgresUrl?.trim()) {
      await insertDeepAnalysisLog(result, predictionId ?? undefined);
    }
    return buildDeepReportMessage(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ ניתוח עמוק נכשל עבור ${escapeHtml(base)}: ${escapeHtml(msg)}`;
  }
}

/** /strategy [standard|conservative|aggressive] — Override AI threshold. */
async function handleStrategy(arg: string): Promise<string> {
  const mode = (arg || '').toLowerCase().trim();
  const map: Record<string, number> = {
    standard: 80,
    conservative: 90,
    aggressive: 75,
  };
  const threshold = map[mode];
  if (threshold == null) {
    return (
      '❌ נא לבחור: <code>standard</code> (80%), <code>conservative</code> (90%), או <code>aggressive</code> (75%).\n' +
      'דוגמה: <code>/strategy conservative</code>'
    );
  }
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ עדכון אסטרטגיה דורש חיבור ל־Quantum Core DB (DATABASE_URL).';
  }
  const reason = 'עדכון ידני מהנהלת המערכת';
  await setStrategyOverride(threshold, reason);
  const labels: Record<number, string> = {
    80: 'סטנדרטי (80%)',
    90: 'שמרנית (90%)',
    75: 'אגרסיבית (75%)',
  };
  return `✅ האסטרטגיה עודכנה על ידי הנהלה: ${labels[threshold] ?? threshold + '%'}. הסף יופעל בסריקות הבאות.`;
}

/** /portfolio — Virtual P&L and open/closed trades */
async function handlePortfolio(): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ תיק סימולציה דורש חיבור ל־Quantum Core DB (DATABASE_URL).';
  }
  const [summary, open, closed] = await Promise.all([
    getVirtualPortfolioSummary(),
    listOpenTrades(),
    listClosedTrades(10),
  ]);
  const parts = [
    '💼 <b>תיק סימולציה (וירטואלי)</b>',
    '',
    `<b>מאזן:</b> ${summary.totalVirtualBalancePct.toFixed(2)}% (ברווח/הפסד מצטבר)`,
    `<b>אחוז הצלחה:</b> ${summary.winRatePct.toFixed(1)}%`,
    `<b>רווח/הפסד יומי:</b> ${summary.dailyPnlPct.toFixed(2)}%`,
    `<b>פוזיציות פתוחות:</b> ${summary.openCount} | <b>סגורות:</b> ${summary.closedCount}`,
  ];
  if (open.length > 0) {
    parts.push('', '<b>פוזיציות פתוחות:</b>');
    for (const t of open.slice(0, 8)) {
      const base = t.symbol.replace('USDT', '');
      parts.push(`• ${base}: $${t.entry_price.toLocaleString()} × $${t.amount_usd}`);
    }
    if (open.length > 8) parts.push(`• ... ועוד ${open.length - 8}`);
  }
  if (closed.length > 0) {
    parts.push('', '<b>סגורות אחרונות:</b>');
    for (const t of closed.slice(0, 5)) {
      const base = t.symbol.replace('USDT', '');
      const pnl = t.pnl_pct != null ? `${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%` : '—';
      parts.push(`• ${base}: ${pnl}`);
    }
  }
  return parts.join('\n');
}

/** /help — פקודות (עברית) */
async function handleHelp(): Promise<string> {
  const override = APP_CONFIG.postgresUrl?.trim() ? await getStrategyOverride() : null;
  const overrideLine =
    override != null
      ? `\n• סף אסטרטגיה נוכחי (ידני): ${override}%.`
      : '';
  const text = [
    '📋 <b>עזרה — מסוף מאוחד</b>',
    '',
    '<b>תפריט קבוע:</b> מצב רובוט · אותות אלפא · אקדמיה · הגדרות.',
    '',
    'פקודות נוספות:',
    '• <code>/status</code> — ארנק סימולציה, מאקרו, סורק.',
    '• <code>/halt</code> — עצירת חירום (כיבוי אוטומציה).',
    '• <code>/brief</code> — תקציר שעה אחרונה.',
    '• <code>/report</code> — דוח חמש עסקאות אחרונות.',
    '• <code>/analyze</code> + סמל — ניתוח עמוק.',
    '• <code>/strategy</code> + מצב — סף כניסה.',
    '• <code>/portfolio</code> — תיק סימולציה.',
    '• <code>/terminal</code> — מסוף מנהלים (מורשים בלבד).',
    '',
    'ניהול אלגוריתמי והנהלה.' + overrideLine,
  ].join('\n');
  return Promise.resolve(text);
}

/** Route command to handler and return reply text */
async function handleCommand(cmd: string, arg: string): Promise<string> {
  switch (cmd) {
    case 'start':
      return handleStart();
    case 'robot':
      await recordRobotHandshakeTelegram();
      return buildRobotStatusMessageHe();
    case 'academy':
      return Promise.resolve(buildAcademyTelegramMessageHe());
    case 'status':
      return handleStatus();
    case 'halt':
      return handleHalt();
    case 'brief':
      return handleBrief();
    case 'report':
      return handleReport();
    case 'analyze':
      return handleAnalyze(arg);
    case 'strategy':
      return handleStrategy(arg);
    case 'portfolio':
      return handlePortfolio();
    case 'help':
      return handleHelp();
    default:
      return 'פקודה לא מוכרת. השתמשו בתפריט הקבוע או <code>/help</code>.';
  }
}

/** Reply to Telegram so the inline button stops spinning. Call this as soon as possible. */
async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text: string
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch {
    // ignore network errors; we still return 200 to Telegram
  }
}

/** Uptime / webhook URL verification (some proxies ping GET). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: 'telegram-webhook',
    ts: new Date().toISOString(),
  });
}

/**
 * POST /api/telegram/webhook
 * Handles: (1) Text commands /start, /status, /report, /analyze, /strategy, /portfolio, /help.
 *          (2) Callback buttons: sim_confirm (Approve), sim_reject (Reject), deep:, ignore:
 * Always returns 200 OK so Telegram does not retry; no cookies/session/CSRF.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 200 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // ——— Text message: only from allowed chat (DB active subscriber when Postgres is configured).
  // Security: non-allowed chat IDs get 200 OK with no processing so Telegram stops retrying; we ignore malicious users entirely.
  // Exception: /terminal is gated only by DB admin user id (or TELEGRAM_ADMIN_CHAT_ID) so executives are not blocked by subscriber list.
  const msg = update.message;
  if (msg?.text && msg.chat?.id != null) {
    const chatId = msg.chat.id;
    const effectiveText = resolveMenuOrCommandText(msg.text);
    const { cmd, arg } = parseCommand(effectiveText);
    if (cmd === 'terminal') {
      if (!(await isInstitutionalTerminalAdmin(msg.from?.id))) {
        return NextResponse.json({ ok: true });
      }
      const t = getToken();
      if (t) {
        const text = await buildTerminalDashboardText();
        await sendTelegramRaw({
          token: t,
          chatId: String(chatId),
          text,
          parse_mode: 'MarkdownV2',
          reply_markup: getTerminalDashboardKeyboard(),
        });
        try {
          await recordAuditLog({
            action_type: EXEC_TERMINAL_AUDIT,
            actor_ip: null,
            user_agent: 'telegram-webhook',
            payload_diff: { action: 'open_terminal', chat_id: String(chatId), user_id: msg.from?.id },
          });
        } catch {
          /* optional */
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (!(await isAllowedChatAsync(chatId))) {
      return NextResponse.json({ ok: true });
    }
    if (cmd) {
      try {
        if (cmd === 'alpha') {
          const summary = await sendAllActiveAlphaSignalsToTelegram();
          await sendToChat(chatId, summary);
          return NextResponse.json({ ok: true });
        }
        if (cmd === 'settings') {
          const t = getToken();
          if (t) {
            await sendTelegramRaw({
              token: t,
              chatId: String(chatId),
              text: '⚙️ <b>הגדרות מסוף</b>\n\nבחרו ערך — השינוי נשמר במסד הנתונים.',
              parse_mode: 'HTML',
              reply_markup: buildSettingsInlineKeyboard(),
            });
          }
          return NextResponse.json({ ok: true });
        }

        const reply = await handleCommand(cmd, arg);
        if (cmd === 'start') {
          const token = getToken();
          if (token) {
            await sendTelegramRaw({
              token,
              chatId: String(chatId),
              text: reply,
              parse_mode: 'HTML',
              reply_markup: getUnifiedReplyKeyboardMarkup(),
            });
          }
        } else {
          await sendToChat(chatId, reply);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(
          chatId,
          [
            '❌ <b>לא ניתן להשלים את הבקשה</b>',
            '',
            'אירעה תקלה בעיבוד הפקודה. נסו שוב בעוד רגע.',
            `אם הבעיה נמשכת, פנו להנהלה עם צילום המסך (<code>${escapeHtml(errMsg.slice(0, 200))}</code>).`,
          ].join('\n')
        );
      }
      return NextResponse.json({ ok: true });
    }
    // Executive Hotline: DB `admin` role or TELEGRAM_ADMIN_CHAT_ID gets Overseer AI for non-command messages
    if (await isAdminChatAsync(chatId)) {
      try {
        const reply = await getOverseerChatReply(msg.text);
        await sendToChat(chatId, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(
          chatId,
          [
            '❌ <b>מפקח עליון — התגובה לא הושלמה</b>',
            '',
            'נסו לנסח מחדש את ההודעה או לחכות רגע ולשלוח שוב.',
            `<code>${escapeHtml(errMsg.slice(0, 220))}</code>`,
          ].join('\n')
        );
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ——— Callback query (inline buttons): authenticate by chat_id, then answer immediately
  const cq = update.callback_query;
  if (!cq?.id || !cq.data) {
    return NextResponse.json({ ok: true });
  }

  const chatIdFromCallback = cq.message?.chat?.id;
  const callbackFromId = cq.from?.id;

  // ——— Institutional Floor 1000 SPA: admin user id only; unauthorized = silent drop (no chat message).
  if (cq.data?.startsWith(INSTITUTIONAL_FLOOR_CB_PREFIX)) {
    if (!(await isInstitutionalTerminalAdmin(callbackFromId))) {
      try {
        await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cq.id }),
        });
      } catch {
        /* ignore */
      }
      return NextResponse.json({ ok: true });
    }
    try {
      await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cq.id }),
      });
    } catch {
      /* ignore */
    }
    const mid = cq.message?.message_id;
    if (chatIdFromCallback != null && mid != null && callbackFromId != null) {
      await handleInstitutionalTerminalCallback({
        token,
        callbackQueryId: cq.id,
        fromUserId: callbackFromId,
        chatId: chatIdFromCallback,
        messageId: mid,
        messageDateUnix: cq.message?.date,
        data: cq.data,
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (!(await isAllowedChatAsync(chatIdFromCallback))) {
    await answerCallbackQuery(token, cq.id, 'לא מורשה.');
    return NextResponse.json({ ok: true });
  }

  const answer = (text: string) => answerCallbackQuery(token, cq.id, text);

  try {
    if (cq.data.startsWith(SETTINGS_CB_PREFIX)) {
      await answer('נשמר');
      const html = await applyTelegramSettingsCallback(cq.data);
      if (chatIdFromCallback != null) {
        await sendToChat(String(chatIdFromCallback), html);
      }
      return NextResponse.json({ ok: true });
    }
    if (cq.data.startsWith(ALPHA_EXEC_CALLBACK_PREFIX)) {
      await answer('מעבד בקשה…');
      const rest = cq.data.slice(ALPHA_EXEC_CALLBACK_PREFIX.length);
      const colon = rest.lastIndexOf(':');
      const sym = colon >= 0 ? rest.slice(0, colon) : rest;
      const tf = colon >= 0 ? rest.slice(colon + 1) : '';
      const { messageHe } = await telegramExecuteAlphaSignal(sym, tf);
      if (chatIdFromCallback != null) {
        await sendToChat(String(chatIdFromCallback), messageHe);
      }
      return NextResponse.json({ ok: true });
    }
    if (cq.data.startsWith(GEM_CALLBACK_PREFIX_REJECT)) {
      const symbolRaw = (cq.data.slice(GEM_CALLBACK_PREFIX_REJECT.length).trim() || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
      const symbol = symbolRaw.toUpperCase().endsWith('USDT') ? symbolRaw.toUpperCase() : `${symbolRaw.toUpperCase()}USDT`;
      if (APP_CONFIG.postgresUrl?.trim()) {
        try {
          await recordAuditLog({
            action_type: 'telegram_trade_rejected',
            actor_ip: null,
            user_agent: null,
            payload_diff: { symbol, source: 'telegram_inline' },
          });
        } catch {
          // audit optional
        }
      }
      await answer('דחית את העסקה — לא נרשם בתיק הסימולציה.');
    } else if (cq.data.startsWith(GEM_CALLBACK_PREFIX_CONFIRM)) {
      const rest = cq.data.slice(GEM_CALLBACK_PREFIX_CONFIRM.length);
      const parts = rest.split(':');
      if (parts.length >= 3) {
        const rawSym = (parts[0]?.trim() || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
        const symbol = rawSym.toUpperCase().endsWith('USDT') ? rawSym.toUpperCase() : `${rawSym.toUpperCase()}USDT`;
        const entryPrice = parseFloat(parts[1] ?? '0');
        const amountUsd = parseFloat(parts[2] ?? '0');
        if (symbol.length >= 4 && Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(amountUsd) && amountUsd > 0) {
          const result = await openVirtualTrade({ symbol, entry_price: entryPrice, amount_usd: amountUsd });
          if (result.success) {
            await answer('סימולציה נרשמה בתיק הוירטואלי.');
          } else {
            await answer(result.error ?? 'שגיאה ברישום.');
          }
        } else {
          await answer('נתונים לא תקינים.');
        }
      } else {
        await answer('פורמט לא תקין.');
      }
    } else if (cq.data.startsWith('deep:')) {
      // Answer first so the button stops spinning; then run slow deep analysis. Sanitize symbol to prevent injection.
      await answer('מעבד...');
      const raw = (cq.data.slice(5).trim() || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
      const symbolFromCallback = raw.toUpperCase();
      const symbol = symbolFromCallback.endsWith('USDT') ? symbolFromCallback : `${symbolFromCallback}USDT`;
      const chatId = String(chatIdFromCallback);
      try {
        const base = symbol.replace(/USDT$/i, '');
        if (!base || !isSupportedBase(base)) {
          await sendToChat(chatId, `❌ הסימבול ${escapeHtml(base || '(ריק)')} אינו נתמך לניתוח עמוק.`);
        } else {
          const result = await performDeepAnalysis(symbol);
          const predictionId = await getLatestPredictionIdBySymbol(symbol);
          if (APP_CONFIG.postgresUrl?.trim()) {
            await insertDeepAnalysisLog(result, predictionId ?? undefined);
          }
          const reportText = buildDeepReportMessage(result);
          await sendToChat(chatId, reportText);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(chatId, `❌ ניתוח עמוק נכשל: ${escapeHtml(String(errMsg))}`);
      }
    } else if (cq.data.startsWith('ignore:')) {
      await answer('התעלמת מההתראה.');
    } else {
      await answer('בוצע.');
    }
  } catch {
    await answer('שגיאה בשרת. נסה שוב.');
  }

  return NextResponse.json({ ok: true });
}
