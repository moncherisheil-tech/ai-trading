/**
 * Telegram Notification Service
 *
 * Sends messages to a configured Telegram chat via the Bot API.
 * Fire-and-forget friendly — catches all errors internally and never
 * throws so callers in the analysis pipeline are never blocked.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Sends a plain or HTML-formatted message to the configured Telegram chat.
 *
 * @param text        The message body (HTML parse mode supported).
 * @param parseMode   'HTML' (default) or 'Markdown'.
 * @returns           `true` if Telegram accepted the message, `false` on any error.
 */
export async function sendTelegramMessage(
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set — skipping notification.');
    return false;
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)');
      console.error(`[Telegram] API error ${res.status}: ${body}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(
      '[Telegram] fetch failed (network/timeout) — alert dropped:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
