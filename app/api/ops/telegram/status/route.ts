import { NextResponse } from 'next/server';

/**
 * GET: Returns whether Telegram is configured (env vars set).
 * Used for dashboard header status indicator. Safe when vars are missing.
 */
export async function GET() {
  try {
    const token =
      typeof process.env.TELEGRAM_BOT_TOKEN === 'string'
        ? process.env.TELEGRAM_BOT_TOKEN.trim()
        : '';
    const chatId =
      typeof process.env.TELEGRAM_CHAT_ID === 'string'
        ? process.env.TELEGRAM_CHAT_ID.trim()
        : '';
    const connected = Boolean(token && chatId);
    return NextResponse.json({ connected });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
