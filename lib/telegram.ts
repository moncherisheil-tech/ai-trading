/**
 * Telegram Bot API integration for Mon Chéri Group.
 * Multi-tenant: when telegram_subscribers has active rows, messages are sent to all of them.
 * Otherwise falls back to TELEGRAM_CHAT_ID from env.
 */
import { getBaseUrl } from '@/lib/config';
import { listActiveSubscriberChatIds } from '@/lib/db/telegram-subscribers';

const TELEGRAM_API_TIMEOUT_MS = 10_000;
const TELEGRAM_API_BASE = 'https://api.telegram.org';

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; error: string; statusCode?: number; rateLimitRetryAfter?: number };

export type TelegramSendOptions = {
  /** Use 'HTML' for <b>, <i>, <code>, <a href="...">. Avoid MarkdownV2 (strict escaping). */
  parse_mode?: 'HTML';
  disable_web_page_preview?: boolean;
  reply_markup?: TelegramReplyMarkup;
};

export type TelegramReplyMarkup =
  | { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }
  | { keyboard: Array<Array<{ text: string }>>; resize_keyboard?: boolean };

function getToken(): string {
  return typeof process.env.TELEGRAM_BOT_TOKEN === 'string'
    ? process.env.TELEGRAM_BOT_TOKEN.trim()
    : '';
}

function getEnvChatId(): string {
  return typeof process.env.TELEGRAM_CHAT_ID === 'string'
    ? process.env.TELEGRAM_CHAT_ID.trim()
    : '';
}

/** Returns chat IDs to send to: all active subscribers, or env TELEGRAM_CHAT_ID if no subscribers. */
async function getBroadcastChatIds(): Promise<string[]> {
  const token = getToken();
  if (!token) return [];
  const fromDb = await listActiveSubscriberChatIds();
  if (fromDb.length > 0) return fromDb;
  const envId = getEnvChatId();
  return envId ? [envId] : [];
}

function getConfig(): { token: string; chatId: string } {
  return { token: getToken(), chatId: getEnvChatId() };
}

/**
 * Escape HTML for Telegram (only <, >, &) so parse_mode: 'HTML' is safe.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Low-level send: requires token and chatId. Used by test route and sendTelegramMessage.
 * Handles timeouts, rate limits (429), invalid token/chat (400/401), and logs failures for debugging.
 */
export async function sendTelegramRaw(params: {
  token: string;
  chatId: string;
  text: string;
  parse_mode?: 'HTML';
  disable_web_page_preview?: boolean;
  /** Inline keyboard: buttons may have callback_data or url. Reply keyboard: keyboard rows of { text }. */
  reply_markup?: TelegramReplyMarkup;
}): Promise<TelegramSendResult> {
  const { token, chatId, text } = params;
  if (!token || !chatId) {
    console.warn(
      '[Telegram] Not configured: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing. Set both in .env to enable.'
    );
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: params.disable_web_page_preview !== false,
  };
  if (params.parse_mode) body.parse_mode = params.parse_mode;
  if (params.reply_markup) body.reply_markup = params.reply_markup;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const raw = await res.text();
    let payload: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      // non-JSON response
    }

    if (res.ok && payload.ok) {
      return { ok: true };
    }

    const statusCode = res.status;
    const description = payload.description || raw || res.statusText;
    const retryAfter = payload.parameters?.retry_after;

    // Log for debugging (Vercel logs / local)
    const logMeta = { statusCode, description, retryAfter };
    if (statusCode === 429) {
      console.warn('[Telegram] Rate limit:', JSON.stringify(logMeta));
      return {
        ok: false,
        error: `Rate limit. Retry after ${retryAfter ?? '?'}s.`,
        statusCode,
        rateLimitRetryAfter: retryAfter,
      };
    }
    if (statusCode === 400 || statusCode === 401) {
      console.error('[Telegram] Bad request or invalid token/chat:', JSON.stringify(logMeta));
      return {
        ok: false,
        error: statusCode === 401 ? 'Invalid bot token.' : `Bad request: ${description}`,
        statusCode,
      };
    }
    console.error('[Telegram] Send failed:', JSON.stringify(logMeta));
    return {
      ok: false,
      error: description,
      statusCode,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    const message = isAbort ? 'Request timeout.' : (e instanceof Error ? e.message : 'Network error');
    console.error('[Telegram] Exception:', message);
    return { ok: false, error: message, statusCode: 0 };
  }
}

/**
 * Send a message to all active Telegram subscribers (or env TELEGRAM_CHAT_ID if no subscribers).
 * Multi-tenant: iterates over all is_active=true chat_ids. No-op if not configured.
 */
export async function sendTelegramMessage(
  text: string,
  options?: TelegramSendOptions
): Promise<TelegramSendResult> {
  const token = getToken();
  if (!token) {
    console.warn('[Telegram] Not configured: TELEGRAM_BOT_TOKEN missing.');
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }
  const chatIds = await getBroadcastChatIds();
  if (chatIds.length === 0) {
    console.warn('[Telegram] No subscribers and TELEGRAM_CHAT_ID not set.');
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }
  let lastResult: TelegramSendResult = { ok: false, error: 'NO_RECIPIENTS', statusCode: 0 };
  for (const chatId of chatIds) {
    const result = await sendTelegramRaw({
      token,
      chatId,
      text,
      parse_mode: options?.parse_mode,
      disable_web_page_preview: options?.disable_web_page_preview,
      reply_markup: options?.reply_markup,
    });
    lastResult = result;
    if (!result.ok && result.statusCode === 400) break;
  }
  return lastResult;
}

export function getDashboardReportKeyboard(baseUrl: string): TelegramReplyMarkup {
  const root = (baseUrl || '').replace(/\/$/, '');
  return {
    inline_keyboard: [
      [
        { text: '🔍 Deep Analysis', url: `${root}/insights` },
        { text: '📊 View Chart', url: `${root}/performance` },
      ],
      [{ text: '⚙️ Adjust Strategy', url: `${root}/settings` }],
    ],
  };
}

/** callback_data max 64 bytes. Format: sim_confirm:SYMBOL:PRICE:AMOUNT (e.g. sim_confirm:BTCUSDT:50000:100) */
const GEM_CALLBACK_PREFIX_CONFIRM = 'sim_confirm:';
const GEM_CALLBACK_PREFIX_REJECT = 'sim_reject:';
const GEM_CALLBACK_DEEP = 'deep:';
const GEM_CALLBACK_IGNORE = 'ignore:';

/** TradingView chart URL for Binance spot (e.g. BINANCE:BTCUSDT). */
export function getTradingViewChartUrl(symbol: string): string {
  const s = (symbol || '').replace(/USDT$/i, '') + 'USDT';
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${s}`;
}

/**
 * Send a Gem alert with inline buttons: View on TradingView, Approve Trade, Reject Trade; secondary: Deep analysis, Ignore.
 * Rich HTML formatting: bolding, <code> for prices. Callbacks update DB via webhook.
 */
export async function sendGemAlert(params: {
  symbol: string;
  entryPrice: number;
  amountUsd: number;
  messageText?: string;
}): Promise<TelegramSendResult> {
  const token = getToken();
  if (!token) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  const chatIds = await getBroadcastChatIds();
  if (chatIds.length === 0) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  const { symbol, entryPrice, amountUsd, messageText } = params;
  const base = symbol.replace('USDT', '');
  const text =
    messageText ||
    `💎 <b>ג'ם זוהה</b>\n\nנכס: <b>${escapeHtml(base)}</b>\nמחיר כניסה: <code>$${entryPrice.toLocaleString()}</code>\nסכום וירטואלי: <code>$${amountUsd.toLocaleString()}</code>\n\nבחר פעולה:`;
  const priceStr = Math.round(entryPrice).toString();
  const amountStr = Math.round(amountUsd).toString();
  const callbackConfirm = `${GEM_CALLBACK_PREFIX_CONFIRM}${symbol}:${priceStr}:${amountStr}`.slice(0, 64);
  const callbackReject = `${GEM_CALLBACK_PREFIX_REJECT}${symbol}`.slice(0, 64);
  const callbackDeep = `${GEM_CALLBACK_DEEP}${symbol}`.slice(0, 64);
  const callbackIgnore = `${GEM_CALLBACK_IGNORE}${symbol}`.slice(0, 64);
  const tradingViewUrl = getTradingViewChartUrl(symbol);
  const strategyUrl = `${getBaseUrl()}/settings`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '📊 View on TradingView', url: tradingViewUrl },
        { text: '✅ Approve Trade', callback_data: callbackConfirm },
        { text: '🛑 Reject Trade', callback_data: callbackReject },
      ],
      [
        { text: '🔍 ניתוח עמוק', callback_data: callbackDeep },
        { text: '⚙️ Adjust Strategy', url: strategyUrl },
        { text: '❌ התעלם', callback_data: callbackIgnore },
      ],
    ],
  };
  let lastResult: TelegramSendResult = { ok: false, error: 'NO_RECIPIENTS', statusCode: 0 };
  for (const chatId of chatIds) {
    const result = await sendTelegramRaw({
      token,
      chatId,
      text,
      parse_mode: 'HTML',
      reply_markup,
    });
    lastResult = result;
  }
  return lastResult;
}

/**
 * Elite Signal alert: Confidence > 85%. High-priority format with reasoning, Gem Score, master insight, and simulation link.
 */
export async function sendEliteAlert(params: {
  symbol: string;
  entryPrice: number;
  amountUsd: number;
  confidence: number;
  reasoning: string;
  marketSafetyStatus: 'Safe' | 'Caution' | 'Dangerous';
  simulationLink?: string;
  messageText?: string;
  /** MoE Gem Score (1/6 per expert — 6-Agent Board). */
  gemScore?: number;
  /** Overseer/Judge consensus insight in Hebrew (entry/exit context). */
  masterInsightHe?: string;
  /** Macro & Order Book expert logic in Hebrew (appended to executive summary). */
  macroLogicHe?: string;
  /** On-Chain Sleuth expert logic in Hebrew (optional). */
  onchainLogicHe?: string;
  /** Deep Memory (Vector) expert verdict in Hebrew — 6th agent (optional). */
  deepMemoryLogicHe?: string;
  /** Optional TP/SL % for monospace ladder (Protocol Omega alerts). */
  takeProfitPct?: number;
  stopLossPct?: number;
}): Promise<TelegramSendResult> {
  const token = getToken();
  if (!token) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  const chatIds = await getBroadcastChatIds();
  if (chatIds.length === 0) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  const base = params.symbol.replace('USDT', '');
  const safetyHe = params.marketSafetyStatus === 'Safe' ? 'בטוח' : params.marketSafetyStatus === 'Caution' ? 'זהירות' : 'מסוכן';
  const riskColor =
    params.marketSafetyStatus === 'Safe' ? '#4ade80' : params.marketSafetyStatus === 'Caution' ? '#fbbf24' : '#fb7185';
  const tp =
    params.takeProfitPct != null && Number.isFinite(params.takeProfitPct)
      ? `TP: +${params.takeProfitPct.toFixed(2)}%`
      : 'TP: —';
  const sl =
    params.stopLossPct != null && Number.isFinite(params.stopLossPct)
      ? `SL: ${params.stopLossPct.toFixed(2)}%`
      : 'SL: —';
  const ladder = `<pre>Entry: $${params.entryPrice.toLocaleString()}
${tp}
${sl}
Conf: ${params.confidence}/100</pre>`;
  const gemScoreLine =
    params.gemScore != null && Number.isFinite(params.gemScore)
      ? '\n<b>ציון Gem (MoE):</b> ' + Math.round(params.gemScore * 10) / 10 + '/100'
      : '';
  const masterInsightHe = (params.masterInsightHe ?? '').trim();
  const macroLogicHe = (params.macroLogicHe ?? '').trim();
  const onchainLogicHe = (params.onchainLogicHe ?? '').trim();
  const deepMemoryLogicHe = (params.deepMemoryLogicHe ?? '').trim();
  const masterInsightLine = masterInsightHe
    ? '\n\n<b>תובנת קונצנזוס:</b>\n' + escapeHtml(masterInsightHe.slice(0, 400))
    : '';
  const macroLogicLine = macroLogicHe
    ? '\n\n<b>מקרו / Order Book:</b>\n' + escapeHtml(macroLogicHe.slice(0, 300))
    : '';
  const onchainLogicLine = onchainLogicHe
    ? '\n\n<b>On-Chain:</b>\n' + escapeHtml(onchainLogicHe.slice(0, 200))
    : '';
  const deepMemoryLogicLine = deepMemoryLogicHe
    ? '\n\n<b>Deep Memory:</b>\n' + escapeHtml(deepMemoryLogicHe.slice(0, 200))
    : '';
  const text =
    params.messageText ||
    [
      '🚀 <b>איתות אליט עוצמתי</b> (ביטחון: <code>' + params.confidence + '/100</code>)' + gemScoreLine,
      '',
      ladder,
      '',
      'מטבע: <b>' + escapeHtml(base) + '</b>',
      'מחיר כניסה: <code>$' + params.entryPrice.toLocaleString() + '</code>',
      '',
      '<b>נימוק טכני:</b>',
      escapeHtml((params.reasoning || 'אין נימוק זמין.').slice(0, 500)) + masterInsightLine + macroLogicLine + onchainLogicLine + deepMemoryLogicLine,
      '',
      `<b>מדד בטיחות שוק:</b> <span style="color:${riskColor}"><b>${safetyHe}</b></span>`,
      params.simulationLink ? '\n🔗 <a href="' + params.simulationLink + '">מסחר סימולציה</a>' : '',
      '',
      'בחר פעולה:',
    ]
      .filter(Boolean)
      .join('\n');
  const priceStr = Math.round(params.entryPrice).toString();
  const amountStr = Math.round(params.amountUsd).toString();
  const callbackConfirm = `${GEM_CALLBACK_PREFIX_CONFIRM}${params.symbol}:${priceStr}:${amountStr}`.slice(0, 64);
  const callbackReject = `${GEM_CALLBACK_PREFIX_REJECT}${params.symbol}`.slice(0, 64);
  const callbackDeep = `${GEM_CALLBACK_DEEP}${params.symbol}`.slice(0, 64);
  const callbackIgnore = `${GEM_CALLBACK_IGNORE}${params.symbol}`.slice(0, 64);
  const tradingViewUrl = getTradingViewChartUrl(params.symbol);
  const strategyUrl = `${getBaseUrl()}/settings`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '📊 View on TradingView', url: tradingViewUrl },
        { text: '✅ Approve Trade', callback_data: callbackConfirm },
        { text: '🛑 Reject Trade', callback_data: callbackReject },
      ],
      [
        { text: '🔍 ניתוח עמוק', callback_data: callbackDeep },
        { text: '⚙️ Adjust Strategy', url: strategyUrl },
        { text: '❌ התעלם', callback_data: callbackIgnore },
      ],
    ],
  };
  let lastResult: TelegramSendResult = { ok: false, error: 'NO_RECIPIENTS', statusCode: 0 };
  for (const chatId of chatIds) {
    const result = await sendTelegramRaw({
      token,
      chatId,
      text,
      parse_mode: 'HTML',
      reply_markup,
    });
    lastResult = result;
  }
  return lastResult;
}

export { GEM_CALLBACK_PREFIX_CONFIRM, GEM_CALLBACK_PREFIX_REJECT, GEM_CALLBACK_DEEP, GEM_CALLBACK_IGNORE };

/**
 * Predefined test message payloads for admin verification.
 */
export const TELEGRAM_TEST_MESSAGES = {
  connection: 'חיבור תקין למערכת Mon Chéri',
  system: '🟢 System Online — Mon Chéri Financial Terminal',
  trade: '📊 Test Trade Executed — סימולציה',
  integration: '🟢 Telegram Integration Active & Working!',
} as const;

export type TelegramTestVariant = keyof typeof TELEGRAM_TEST_MESSAGES;
