/**
 * Telegram Webhook: Interactive Command Center + callback buttons.
 * All user-facing text in RTL Hebrew. Use "הנהלה" and "אלגוריתם" — no personal names.
 */

import { NextRequest, NextResponse } from 'next/server';
import { openVirtualTrade } from '@/lib/simulation-service';
import {
  GEM_CALLBACK_PREFIX_CONFIRM,
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

const TELEGRAM_API = 'https://api.telegram.org';

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

/** /status — Macro Pulse, Scanner Status, Today's Gems */
async function handleStatus(): Promise<string> {
  const [macro, scanner, gemsToday] = await Promise.all([
    getMacroPulse(),
    Promise.resolve(getScannerState()),
    APP_CONFIG.dbDriver === 'sqlite' ? Promise.resolve(countScannerAlertsToday()) : Promise.resolve(0),
  ]);
  const statusHe = scanner.status === 'ACTIVE' ? 'פעיל' : 'ממתין';
  const lastScan = scanner.lastScanTime
    ? new Date(scanner.lastScanTime).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const parts = [
    '📊 <b>סטטוס מערכת — מרכז פקודות</b>',
    '',
    '<b>מאקרו (פחד ותאווה / דומיננטיות BTC):</b>',
    `• מדד פחד ותאווה: ${macro.fearGreedIndex} (${macro.fearGreedClassification})`,
    `• דומיננטיות BTC: ${macro.btcDominancePct}%`,
    `• אסטרטגיה: ${macro.strategyLabelHe}`,
    '',
    '<b>סורק השוק (אלגוריתם):</b>',
    `• סטטוס: ${statusHe}`,
    `• סריקה אחרונה: ${lastScan}`,
    `• ג\'מים היום: ${gemsToday}`,
  ];
  if (scanner.lastRunStats) {
    parts.push(
      '',
      `• נסרקו: ${scanner.lastRunStats.coinsChecked} | נמצאו: ${scanner.lastRunStats.gemsFound} | התראות נשלחו: ${scanner.lastRunStats.alertsSent}`
    );
  }
  return parts.join('\n');
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
    const predictionId = getLatestPredictionIdBySymbol(symbol);
    if (APP_CONFIG.dbDriver === 'sqlite') {
      insertDeepAnalysisLog(result, predictionId ?? undefined);
    }
    return buildDeepReportMessage(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ ניתוח עמוק נכשל עבור ${base}: ${msg}`;
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
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return '❌ עדכון אסטרטגיה זמין רק כאשר DB_DRIVER=sqlite.';
  }
  const reason = 'עדכון ידני מהנהלת המערכת';
  setStrategyOverride(threshold, reason);
  const labels: Record<number, string> = {
    80: 'סטנדרטי (80%)',
    90: 'שמרנית (90%)',
    75: 'אגרסיבית (75%)',
  };
  return `✅ האסטרטגיה עודכנה על ידי הנהלה: ${labels[threshold] ?? threshold + '%'}. הסף יופעל בסריקות הבאות.`;
}

/** /portfolio — Virtual P&L and open/closed trades */
async function handlePortfolio(): Promise<string> {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return '❌ תיק סימולציה זמין רק כאשר DB_DRIVER=sqlite.';
  }
  const summary = getVirtualPortfolioSummary();
  const open = listOpenTrades();
  const closed = listClosedTrades(10);
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
function handleHelp(): Promise<string> {
  const override = APP_CONFIG.dbDriver === 'sqlite' ? getStrategyOverride() : null;
  const overrideLine =
    override != null
      ? `\n• האסטרטגיה הנוכחית: סף ידני ${override}% (הנהלה).`
      : '';
  const text = [
    '📋 <b>מרכז פקודות — עזרה</b>',
    '',
    'פקודות זמינות:',
    '• <code>/status</code> — סטטוס מערכת: מאקרו (פחד/תאווה, BTC), סורק, ג\'מים היום.',
    '• <code>/analyze [סימבול]</code> — ניתוח עמוק רב-מודלי לנכס (למשל BTC, ETH).',
    '• <code>/strategy standard|conservative|aggressive</code> — עדכון סף כניסה (80% / 90% / 75%) על ידי הנהלה.',
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
    case 'status':
      return handleStatus();
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

/**
 * POST /api/telegram/webhook
 * Handles: (1) Text commands /status, /analyze, /strategy, /portfolio, /help.
 *          (2) Callback buttons: sim_confirm, deep:, ignore:
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

  // ——— Text commands (message)
  const msg = update.message;
  if (msg?.text && msg.chat?.id != null) {
    const chatId = msg.chat.id;
    const { cmd, arg } = parseCommand(msg.text);
    if (cmd) {
      try {
        const reply = await handleCommand(cmd, arg);
        await sendToChat(chatId, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(chatId, `❌ שגיאה: ${errMsg}`);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ——— Callback query (inline buttons)
  const cq = update.callback_query;
  if (!cq?.id || !cq.data) {
    return NextResponse.json({ ok: true });
  }

  const answerCallback = async (text: string): Promise<void> => {
    try {
      await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cq.id, text }),
      });
    } catch {
      // ignore
    }
  };

  try {
    if (cq.data.startsWith(GEM_CALLBACK_PREFIX_CONFIRM)) {
      const rest = cq.data.slice(GEM_CALLBACK_PREFIX_CONFIRM.length);
      const parts = rest.split(':');
      if (parts.length >= 3) {
        const symbol = parts[0]?.trim() || '';
        const entryPrice = parseFloat(parts[1] ?? '0');
        const amountUsd = parseFloat(parts[2] ?? '0');
        if (symbol && entryPrice > 0 && amountUsd > 0) {
          const result = openVirtualTrade({ symbol, entry_price: entryPrice, amount_usd: amountUsd });
          if (result.success) {
            await answerCallback('סימולציה נרשמה בתיק הוירטואלי.');
          } else {
            await answerCallback(result.error ?? 'שגיאה ברישום.');
          }
        } else {
          await answerCallback('נתונים לא תקינים.');
        }
      } else {
        await answerCallback('פורמט לא תקין.');
      }
    } else if (cq.data.startsWith('deep:')) {
      const symbolFromCallback = cq.data.slice(5).trim();
      const symbol = symbolFromCallback.endsWith('USDT') ? symbolFromCallback : `${symbolFromCallback}USDT`;
      await answerCallback('מבצע ניתוח עמוק רב-מודלי... אנא המתן.');
      const chatId = String(cq.message?.chat?.id ?? getDefaultChatId());
      try {
        const base = symbol.replace(/USDT$/i, '');
        if (!isSupportedBase(base)) {
          await sendToChat(chatId, `❌ הסימבול ${base} אינו נתמך לניתוח עמוק.`);
        } else {
          const result = await performDeepAnalysis(symbol);
          const predictionId = getLatestPredictionIdBySymbol(symbol);
          if (APP_CONFIG.dbDriver === 'sqlite') {
            insertDeepAnalysisLog(result, predictionId ?? undefined);
          }
          const reportText = buildDeepReportMessage(result);
          await sendToChat(chatId, reportText);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'שגיאה לא צפויה';
        await sendToChat(chatId, `❌ ניתוח עמוק נכשל: ${errMsg}`);
      }
    } else if (cq.data.startsWith('ignore:')) {
      await answerCallback('התעלמת מההתראה.');
    } else {
      await answerCallback('בוצע.');
    }
  } catch (err) {
    await answerCallback('שגיאה בשרת. נסה שוב.');
  }

  return NextResponse.json({ ok: true });
}
