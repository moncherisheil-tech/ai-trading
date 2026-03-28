import { NextResponse } from 'next/server';
import { sendTelegramRaw, TELEGRAM_TEST_MESSAGES, type TelegramTestVariant } from '@/lib/telegram';

/**
 * POST: Send a test message to Telegram.
 * Body (optional): { token?: string, chatId?: string, variant?: 'connection' | 'system' | 'trade' }
 * - token/chatId: use for this request only; else use env.
 * - variant: which test message to send (default: 'connection').
 */
export async function POST(request: Request) {
  try {
    let token =
      typeof process.env.TELEGRAM_BOT_TOKEN === 'string'
        ? process.env.TELEGRAM_BOT_TOKEN.trim()
        : '';
    let chatId =
      typeof process.env.TELEGRAM_CHAT_ID === 'string'
        ? process.env.TELEGRAM_CHAT_ID.trim()
        : '';
    const body = await request.json().catch(() => ({}));
    if (body?.token && body?.chatId) {
      token = String(body.token).trim();
      chatId = String(body.chatId).trim();
    }
    const variant: TelegramTestVariant =
      body?.variant && TELEGRAM_TEST_MESSAGES[body.variant as TelegramTestVariant]
        ? body.variant
        : 'connection';

    if (!token || !chatId) {
      console.warn(
        '[Telegram Test API] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Set both in .env to test.'
      );
      return NextResponse.json(
        { ok: false, error: 'טלגרם לא מוגדר. הגדר TELEGRAM_BOT_TOKEN ו-TELEGRAM_CHAT_ID.' },
        { status: 400 }
      );
    }

    const text = TELEGRAM_TEST_MESSAGES[variant];
    const result = await sendTelegramRaw({ token, chatId, text });

    if (result.ok) {
      return NextResponse.json({ ok: true, variant });
    }
    console.error('[Telegram Test API] Send failed:', result.error, 'statusCode:', result.statusCode);
    const userMessage =
      result.statusCode === 429
        ? `קצב בקשות חרג. נסה שוב בעוד ${result.rateLimitRetryAfter ?? 60} שניות.`
        : result.statusCode === 401
          ? 'טוקן בוט לא תקין.'
          : result.statusCode === 400
            ? 'מזהה צ׳אט או פרמטרים לא תקינים.'
            : result.error || 'שגיאה בשליחת הודעה';
    return NextResponse.json({ ok: false, error: userMessage }, { status: 200 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'שגיאה בשליחת הודעה';
    console.error('[Telegram Test API] Exception:', e);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
