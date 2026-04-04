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
  /** Use 'HTML', 'Markdown', or 'MarkdownV2'. */
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
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

function escapeMarkdown(text: string): string {
  return text.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Low-level send: requires token and chatId. Used by test route and sendTelegramMessage.
 * Handles timeouts, rate limits (429), invalid token/chat (400/401), and logs failures for debugging.
 */
export async function sendTelegramRaw(params: {
  token: string;
  chatId: string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
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
 * Edit an existing message (SPA dashboard updates). Same parse modes as sendMessage.
 */
export async function editTelegramMessage(params: {
  token: string;
  chatId: string;
  messageId: number;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disable_web_page_preview?: boolean;
  reply_markup?: TelegramReplyMarkup;
}): Promise<TelegramSendResult> {
  const { token, chatId, messageId, text } = params;
  if (!token || !chatId || !messageId) {
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }
  const url = `${TELEGRAM_API_BASE}/bot${token}/editMessageText`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
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
    let payload: { ok?: boolean; description?: string } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      /* empty */
    }
    if (res.ok && payload.ok) return { ok: true };
    return {
      ok: false,
      error: payload.description || raw || res.statusText,
      statusCode: res.status,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : 'Network error';
    return { ok: false, error: message, statusCode: 0 };
  }
}

/** Update only inline keyboard (e.g. strip on session expiry). */
export async function editTelegramReplyMarkup(params: {
  token: string;
  chatId: string;
  messageId: number;
  reply_markup: TelegramReplyMarkup | { inline_keyboard: [] };
}): Promise<TelegramSendResult> {
  const { token, chatId, messageId } = params;
  if (!token || !chatId || !messageId) {
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  }
  const url = `${TELEGRAM_API_BASE}/bot${token}/editMessageReplyMarkup`;
  const body = {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: params.reply_markup,
  };
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
    let payload: { ok?: boolean; description?: string } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      /* empty */
    }
    if (res.ok && payload.ok) return { ok: true };
    return {
      ok: false,
      error: payload.description || raw || res.statusText,
      statusCode: res.status,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : 'Network error';
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

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0.0000';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
}

export function getDashboardReportKeyboard(baseUrl: string): TelegramReplyMarkup {
  const safeUrl = (baseUrl || getBaseUrl()).replace(/\/$/, '');
  return {
    inline_keyboard: [
      [
        { text: '🔍 Deep Analysis', url: `${safeUrl}/insights` },
        { text: '📊 View Chart', url: `${safeUrl}/performance` },
      ],
      [{ text: '⚙️ Adjust Strategy', url: `${safeUrl}/settings` }],
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
    [
      '⚠️ *Scanner Signal*',
      `Asset: *${escapeMarkdown(base)}*`,
      `Entry: \`${formatPrice(entryPrice)}\``,
      `Size USD: \`${formatPrice(amountUsd)}\``,
      '',
      '_Select action:_',
    ].join('\n');
  const priceStr = entryPrice.toFixed(2);
  const amountStr = amountUsd.toFixed(2);
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
      parse_mode: 'Markdown',
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
  const safetyIcon = params.marketSafetyStatus === 'Safe' ? '🟢' : params.marketSafetyStatus === 'Dangerous' ? '🔴' : '⚠️';
  const tp =
    params.takeProfitPct != null && Number.isFinite(params.takeProfitPct)
      ? `TP: +${params.takeProfitPct.toFixed(2)}%`
      : 'TP: —';
  const sl =
    params.stopLossPct != null && Number.isFinite(params.stopLossPct)
      ? `SL: ${params.stopLossPct.toFixed(2)}%`
      : 'SL: —';
  const ladder = [
    `Entry: \`${formatPrice(params.entryPrice)}\``,
    `${tp}`,
    `${sl}`,
    `Conf: \`${formatPercent(params.confidence)}\``,
  ].join('\n');
  const gemScoreLine =
    params.gemScore != null && Number.isFinite(params.gemScore)
      ? `Gem Score: \`${formatPercent(params.gemScore)}\``
      : '';
  const masterInsightHe = (params.masterInsightHe ?? '').trim();
  const macroLogicHe = (params.macroLogicHe ?? '').trim();
  const onchainLogicHe = (params.onchainLogicHe ?? '').trim();
  const deepMemoryLogicHe = (params.deepMemoryLogicHe ?? '').trim();
  const extraReasoningBlocks = [
    masterInsightHe ? `Consensus Insight: ${masterInsightHe.slice(0, 300)}` : '',
    macroLogicHe ? `Macro / Order Book: ${macroLogicHe.slice(0, 220)}` : '',
    onchainLogicHe ? `On-Chain: ${onchainLogicHe.slice(0, 160)}` : '',
    deepMemoryLogicHe ? `Deep Memory: ${deepMemoryLogicHe.slice(0, 160)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const text =
    params.messageText ||
    [
      '🐋 *Elite Signal*',
      '',
      `Asset: *${escapeMarkdown(base)}*`,
      ladder,
      gemScoreLine,
      `${safetyIcon} Market Safety: *${safetyHe}*`,
      '',
      '*Reasoning*',
      escapeMarkdown((params.reasoning || 'אין נימוק זמין.').slice(0, 360)),
      extraReasoningBlocks ? escapeMarkdown(extraReasoningBlocks) : '',
      '',
      params.simulationLink ? `Simulation: ${escapeMarkdown(params.simulationLink)}` : '',
      '',
      '_Select action:_',
    ]
      .filter(Boolean)
      .join('\n');
  const priceStr = params.entryPrice.toFixed(2);
  const amountStr = params.amountUsd.toFixed(2);
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
      parse_mode: 'Markdown',
      reply_markup,
    });
    lastResult = result;
  }
  return lastResult;
}

export type SignalOfGoldParams = {
  /** e.g. BTC/USDT */
  symbolDisplay: string;
  /** Binance symbol e.g. BTCUSDT (for chart links). */
  symbolBinance: string;
  strengthPct: number;
  bias: 'Bullish' | 'Bearish';
  /** Live reference mid (display only). */
  spotPrice: number;
  entryLow: number;
  entryHigh: number;
  takeProfit: number;
  stopLoss: number;
  consensusExcerpt: string;
};

/**
 * Floor 1000 — institutional "Signal of Gold" alert (HTML).
 * Includes symbol, strength, entry zone, TP/SL, consensus excerpt.
 */
export async function sendSignalOfGoldAlert(params: SignalOfGoldParams): Promise<TelegramSendResult> {
  const token = getToken();
  if (!token) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  const chatIds = await getBroadcastChatIds();
  if (chatIds.length === 0) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };

  const biasLabelHe =
    params.bias === 'Bullish' ? 'לונג (Bullish)' : 'שורט (Bearish)';
  const excerpt = escapeHtml(params.consensusExcerpt.trim().slice(0, 420));
  const sym = escapeHtml(params.symbolDisplay);
  const strength = Math.max(0, Math.min(100, Math.round(params.strengthPct)));
  const spot = formatPrice(params.spotPrice);
  const lo = formatPrice(params.entryLow);
  const hi = formatPrice(params.entryHigh);
  const tp = formatPrice(params.takeProfit);
  const sl = formatPrice(params.stopLoss);

  const text = [
    '💎 <b>אות אלפא - קואנטום מון שרי</b> 💎',
    '',
    `<b>נכס</b>: <code>${sym}</code>`,
    `<b>כיוון</b>: <code>${escapeHtml(biasLabelHe)}</code>`,
    `<b>עוצמת סיגנל</b>: <code>${strength}%</code>`,
    `<b>מחיר ייחוס (שוק)</b>: <code>${spot}</code>`,
    '',
    '<b>אזור כניסה</b>',
    `<code>${lo}</code> — <code>${hi}</code>`,
    '',
    '<b>יעדי רווח (TP) / סטופ לוס (SL)</b>',
    `<code>${tp}</code> · <code>${sl}</code>`,
    '',
    '<b>רציונל הקונסנזוס</b>',
    excerpt || '<code>—</code>',
  ].join('\n');

  const strategyUrl = `${getBaseUrl()}/settings`;
  const tradingViewUrl = getTradingViewChartUrl(params.symbolBinance);
  const reply_markup: TelegramReplyMarkup = {
    inline_keyboard: [
      [
        { text: '📊 גרף TradingView', url: tradingViewUrl },
        { text: '⚙️ אסטרטגיה והגדרות', url: strategyUrl },
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

// ─────────────────────────────────────────────────────────────────────────────
// ENTERPRISE ALPHA SIGNAL INTELLIGENCE ALERT (Wall-Street Grade)
// ─────────────────────────────────────────────────────────────────────────────

export type AlphaSignalIntelAlertParams = {
  /** e.g. "BTCUSDT" */
  symbol: string;
  /** Direction of the signal */
  direction: 'Long' | 'Short';
  /** Human-readable origin: "Whale Movement", "Tech Breakout", "On-Chain Accumulation", etc. */
  signalOrigin: string;
  /** CEO Overseer final verdict */
  ceoVerdict: 'TRADE' | 'HOLD';
  /** Confidence from MoE (0–100) */
  confidencePct: number;
  /** Suggested capital to allocate in USD */
  suggestedCapitalUsd: number;
  /** Exact entry price */
  entryPrice: number;
  /** Stop-loss absolute price (null if no SL) */
  stopLossPrice?: number | null;
  /** Stop-loss % from entry */
  stopLossPct?: number | null;
  /** Take-profit absolute price */
  takeProfitPrice?: number | null;
  /** Take-profit % from entry */
  takeProfitPct?: number | null;
  /** Timeframe label e.g. "Daily", "Hourly" */
  timeframe?: string;
  /** One-line summary of what the 7 MoE experts agreed on */
  moeConsensusSummary: string;
  /** Whale confirmation flag */
  whaleConfirmed?: boolean;
  /** R:R ratio (e.g. 2.5 = 1:2.5) */
  rrRatio?: number | null;
};

/**
 * Enterprise-grade Alpha Signal Intelligence Alert for Telegram.
 * HTML parse mode with full institutional-grade signal data:
 * signal origin, CEO verdict, capital, entry, SL/TP, and 7-expert MoE consensus.
 */
export async function sendAlphaSignalIntelAlert(
  params: AlphaSignalIntelAlertParams
): Promise<TelegramSendResult> {
  const token = getToken();
  if (!token) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };
  const chatIds = await getBroadcastChatIds();
  if (chatIds.length === 0) return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED', statusCode: 0 };

  const base = params.symbol.replace(/USDT$/i, '');
  const dirIcon = params.direction === 'Long' ? '🟢' : '🔴';
  const dirLabel = params.direction === 'Long' ? 'LONG ▲' : 'SHORT ▼';
  const verdictIcon = params.ceoVerdict === 'TRADE' ? '✅' : '🔶';
  const whaleIcon = params.whaleConfirmed ? '🐋 מאושר' : '—';
  const tf = params.timeframe ?? '—';

  const slLine =
    params.stopLossPrice != null
      ? `<code>${formatPrice(params.stopLossPrice)}</code>${params.stopLossPct != null ? ` <i>(${Math.abs(params.stopLossPct).toFixed(2)}%)</i>` : ''}`
      : '<i>ללא סטופ לוס</i>';

  const tpLine =
    params.takeProfitPrice != null
      ? `<code>${formatPrice(params.takeProfitPrice)}</code>${params.takeProfitPct != null ? ` <i>(+${Math.abs(params.takeProfitPct).toFixed(2)}%)</i>` : ''}`
      : '<i>—</i>';

  const rrLine =
    params.rrRatio != null && params.rrRatio > 0
      ? `<code>1 : ${params.rrRatio.toFixed(2)}</code>`
      : '<i>—</i>';

  const consensusTrimmed = escapeHtml((params.moeConsensusSummary ?? '').trim().slice(0, 380));
  const originEscaped = escapeHtml(params.signalOrigin.trim());

  const confBar = (() => {
    const filled = Math.min(10, Math.max(0, Math.round(params.confidencePct / 10)));
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  })();

  const text = [
    `${dirIcon} <b>ALPHA SIGNAL — QUANTUM MON CHERI</b>`,
    '',
    `<b>נכס</b>: <code>${escapeHtml(base)}/USDT</code>  |  <b>אופק</b>: <code>${escapeHtml(tf)}</code>`,
    `<b>כיוון</b>: <b>${dirLabel}</b>`,
    '',
    `🚨 <b>מקור הסיגנל</b>: ${originEscaped}`,
    `${verdictIcon} <b>פסיקת CEO Overseer</b>: <b>${params.ceoVerdict}</b>`,
    '',
    `💰 <b>הון מוצע</b>: <code>$${formatPrice(params.suggestedCapitalUsd)}</code>`,
    `📍 <b>מחיר כניסה</b>: <code>$${formatPrice(params.entryPrice)}</code>`,
    '',
    `🛡️ <b>פרמטרי סיכון</b>`,
    `  ├ Stop Loss: ${slLine}`,
    `  ├ Take Profit: ${tpLine}`,
    `  └ R:R Ratio: ${rrLine}`,
    '',
    `🐋 <b>אישור לווייתן</b>: ${whaleIcon}`,
    '',
    `📊 <b>קונצנזוס MoE — 7 מומחים</b>`,
    `<i>${consensusTrimmed || '—'}</i>`,
    '',
    `<b>ביטחון</b>: <code>${params.confidencePct.toFixed(1)}%</code>  <code>${confBar}</code>`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const tradingViewUrl = getTradingViewChartUrl(params.symbol);
  const strategyUrl = `${getBaseUrl()}/settings`;
  const reply_markup: TelegramReplyMarkup = {
    inline_keyboard: [
      [
        { text: '📊 TradingView', url: tradingViewUrl },
        { text: '⚙️ הגדרות אסטרטגיה', url: strategyUrl },
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
      disable_web_page_preview: true,
      reply_markup,
    });
    lastResult = result;
    if (!result.ok && result.statusCode === 400) break;
  }
  return lastResult;
}

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
