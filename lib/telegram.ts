/**
 * Send a message to a Telegram chat via Bot API.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable.
 * No-op if either is missing.
 */
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // Telegram API error — silent in production
    }
  } catch {
    // Network or parse error — silent in production
  }
}
