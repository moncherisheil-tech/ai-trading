/**
 * Telegram Bot API integration for Mon Chéri Group.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable.
 * Supports plain text and HTML-formatted messages with robust error handling and logging.
 */

const TELEGRAM_API_TIMEOUT_MS = 10_000;
const TELEGRAM_API_BASE = 'https://api.telegram.org';

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; error: string; statusCode?: number; rateLimitRetryAfter?: number };

export type TelegramSendOptions = {
  /** Use 'HTML' for <b>, <i>, <code>, <a href="...">. Avoid MarkdownV2 (strict escaping). */
  parse_mode?: 'HTML';
  disable_web_page_preview?: boolean;
};

function getConfig(): { token: string; chatId: string } {
  const token =
    typeof process.env.TELEGRAM_BOT_TOKEN === 'string'
      ? process.env.TELEGRAM_BOT_TOKEN.trim()
      : '';
  const chatId =
    typeof process.env.TELEGRAM_CHAT_ID === 'string'
      ? process.env.TELEGRAM_CHAT_ID.trim()
      : '';
  return { token, chatId };
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
  /** Inline keyboard JSON: { inline_keyboard: [[ { text, callback_data } ]] }. callback_data max 64 bytes. */
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
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
 * Send a message to the configured Telegram chat (env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
 * No-op if not configured; returns result so callers can log failures.
 */
export async function sendTelegramMessage(
  text: string,
  options?: TelegramSendOptions
): Promise<TelegramSendResult> {
  const { token, chatId } = getConfig();
  if (!token || !chatId) {
    console.warn(
      '[Telegram] Not configured: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing. Set both in .env to enable.'
    );
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }
  return sendTelegramRaw({
    token,
    chatId,
    text,
    parse_mode: options?.parse_mode,
    disable_web_page_preview: options?.disable_web_page_preview,
  });
}

/** callback_data max 64 bytes. Format: sim_confirm:SYMBOL:PRICE:AMOUNT (e.g. sim_confirm:BTCUSDT:50000:100) */
const GEM_CALLBACK_PREFIX_CONFIRM = 'sim_confirm:';
const GEM_CALLBACK_DEEP = 'deep:';
const GEM_CALLBACK_IGNORE = 'ignore:';

/**
 * Send a Gem alert with 3 inline buttons: אשר סימולציה, ניתוח עמוק, התעלם.
 * When "אשר סימולציה" is clicked, the Telegram webhook receives callback_query and can record the trade in virtual_portfolio.
 */
export async function sendGemAlert(params: {
  symbol: string;
  entryPrice: number;
  amountUsd: number;
  messageText?: string;
}): Promise<TelegramSendResult> {
  const { token, chatId } = getConfig();
  if (!token || !chatId) {
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }
  const { symbol, entryPrice, amountUsd, messageText } = params;
  const base = symbol.replace('USDT', '');
  const text =
    messageText ||
    `💎 <b>ג'ם זוהה</b>\n\nנכס: ${base}\nמחיר כניסה: $${entryPrice.toLocaleString()}\nסכום וירטואלי: $${amountUsd}\n\nבחר פעולה:`;
  const priceStr = Math.round(entryPrice).toString();
  const amountStr = Math.round(amountUsd).toString();
  const callbackConfirm = `${GEM_CALLBACK_PREFIX_CONFIRM}${symbol}:${priceStr}:${amountStr}`.slice(0, 64);
  const callbackDeep = `${GEM_CALLBACK_DEEP}${symbol}`.slice(0, 64);
  const callbackIgnore = `${GEM_CALLBACK_IGNORE}${symbol}`.slice(0, 64);
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '🚀 אשר סימולציה', callback_data: callbackConfirm },
        { text: '🔍 ניתוח עמוק', callback_data: callbackDeep },
      ],
      [{ text: '❌ התעלם', callback_data: callbackIgnore }],
    ],
  };
  return sendTelegramRaw({
    token,
    chatId,
    text,
    parse_mode: 'HTML',
    reply_markup,
  });
}

export { GEM_CALLBACK_PREFIX_CONFIRM, GEM_CALLBACK_DEEP, GEM_CALLBACK_IGNORE };

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
