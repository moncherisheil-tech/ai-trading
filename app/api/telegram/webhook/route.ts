/**
 * Telegram Webhook: Interactive Command Center + callback buttons.
 * All user-facing text in RTL Hebrew. Use "הנהלה" and "אלגוריתם" — no personal names.
 *
 * CRITICAL: This route MUST be reachable by Telegram servers without browser cookies,
 * session, or CSRF. Middleware only protects /ops, so /api/* is not blocked.
 * Authentication is by TELEGRAM_CHAT_ID: only updates from that chat are processed.
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

const TELEGRAM_API = 'https://api.telegram.org';

/** Main menu keyboard for /start — sends command as button text. */
const MAIN_MENU_KEYBOARD = [
  ['/status', '/report'],
  ['/analyze', '/help'],
];

/** Telegram Update: message (commands) and/or callback_query (buttons). */
interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number }; message_id?: number };
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

/** Returns true if the chat is the configured TELEGRAM_CHAT_ID (commands) or TELEGRAM_ADMIN_CHAT_ID (Executive Hotline). For admin-only commands, use isAdminChatId instead. */
function isAllowedChatId(chatId: number | string | undefined): boolean {
  const defaultId = getDefaultChatId();
  const adminId = getAdminChatId();
  if (!defaultId && !adminId) return false;
  const id = String(chatId);
  return id === defaultId || (adminId !== '' && id === adminId);
}

/** Returns true only if the chat is the CEO Executive Hotline (TELEGRAM_ADMIN_CHAT_ID). Used to gate Overseer AI. */
function isAdminChatId(chatId: number | string | undefined): boolean {
  const adminId = getAdminChatId();
  if (!adminId) return false;
  return String(chatId) === adminId;
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

/** /start — Welcome message and main menu keyboard */
function handleStart(): string {
  return [
    '🟢 <b>מרכז פקודות טלגרם — Mon Chéri</b>',
    '',
    'שלום! הבוט מחובר ומאפשר שליטה מלאה באיתותים ובתיק הסימולציה.',
    '',
    'השתמש בתפריט למטה או שלח פקודה:',
    '• <code>/status</code> — סיכום ארנק סימולציה + מאקרו + סורק',
    '• <code>/report</code> — דוח מנהלים: 5 העסקאות האחרונות',
    '• <code>/analyze BTC</code> — ניתוח MoE לסימבול',
    '• <code>/help</code> — רשימת פקודות מלאה',
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
  return parts.join('\n');
}

/** /report — Executive summary of last 5 closed trades */
async function handleReport(): Promise<string> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return '❌ דוח עסקאות דורש חיבור ל־Vercel Postgres (DATABASE_URL).';
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
    return '❌ עדכון אסטרטגיה דורש חיבור ל־Vercel Postgres (DATABASE_URL).';
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
    return '❌ תיק סימולציה דורש חיבור ל־Vercel Postgres (DATABASE_URL).';
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

/** /help — List commands in Hebrew */
async function handleHelp(): Promise<string> {
  const override = APP_CONFIG.postgresUrl?.trim() ? await getStrategyOverride() : null;
  const overrideLine =
    override != null
      ? `\n• האסטרטגיה הנוכחית: סף ידני ${override}% (הנהלה).`
      : '';
  const text = [
    '📋 <b>מרכז פקודות — עזרה</b>',
    '',
    'פקודות זמינות:',
    '• <code>/start</code> — הודעת פתיחה ותפריט ראשי.',
    '• <code>/status</code> — סיכום ארנק סימולציה (מאזן, אחוז הצלחה, רווח/הפסד יומי) + מאקרו + סורק.',
    '• <code>/report</code> — דוח מנהלים: סיכום 5 העסקאות הסגורות האחרונות.',
    '• <code>/analyze [סימבול]</code> — ניתוח MoE עמוק לנכס (למשל <code>/analyze BTCUSDT</code>).',
    '• <code>/strategy standard|conservative|aggressive</code> — עדכון סף כניסה (80% / 90% / 75%).',
    '• <code>/portfolio</code> — סיכום תיק סימולציה וירטואלי ורשימת פוזיציות.',
    '• <code>/help</code> — הצגת העזרה הזו.',
    '',
    'כל ההתראות והדוחות מנוהלים על ידי האלגוריתם והנהלה.' + overrideLine,
  ].join('\n');
  return Promise.resolve(text);
}

/** Route command to handler and return reply text */
async function handleCommand(cmd: string, arg: string): Promise<string> {
  switch (cmd) {
    case 'start':
      return handleStart();
    case 'status':
      return handleStatus();
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
      return 'פקודה לא מוכרת. שלח <code>/help</code> לרשימת הפקודות.';
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

  // ——— Text message: only from allowed chat (TELEGRAM_CHAT_ID or TELEGRAM_ADMIN_CHAT_ID).
  // Security: non-allowed chat IDs get 200 OK with no processing so Telegram stops retrying; we ignore malicious users entirely.
  const msg = update.message;
  if (msg?.text && msg.chat?.id != null) {
    if (!isAllowedChatId(msg.chat.id)) {
      return NextResponse.json({ ok: true });
    }
    const chatId = msg.chat.id;
    const { cmd, arg } = parseCommand(msg.text);
    if (cmd) {
      try {
        const reply = await handleCommand(cmd, arg);
        if (cmd === 'start') {
          const token = getToken();
          if (token) {
            await sendTelegramRaw({
              token,
              chatId: String(chatId),
              text: reply,
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: MAIN_MENU_KEYBOARD.map((row) => row.map((text) => ({ text }))),
                resize_keyboard: true,
              },
            });
          }
        } else {
          await sendToChat(chatId, reply);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(chatId, `❌ שגיאה: ${errMsg}`);
      }
      return NextResponse.json({ ok: true });
    }
    // Executive Hotline: only TELEGRAM_ADMIN_CHAT_ID gets Overseer AI for non-command messages
    if (isAdminChatId(chatId)) {
      try {
        const reply = await getOverseerChatReply(msg.text);
        await sendToChat(chatId, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(chatId, `❌ מפקח עליון: ${errMsg}`);
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
  if (!isAllowedChatId(chatIdFromCallback)) {
    await answerCallbackQuery(token, cq.id, 'לא מורשה.');
    return NextResponse.json({ ok: true });
  }

  const answer = (text: string) => answerCallbackQuery(token, cq.id, text);

  try {
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
      const chatId = String(chatIdFromCallback ?? getDefaultChatId());
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
