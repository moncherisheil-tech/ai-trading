import { NextResponse } from 'next/server';
import { listActiveSubscriberChatIds } from '@/lib/db/telegram-subscribers';

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
    const envConnected = Boolean(token && chatId);
    const subscribers = await listActiveSubscriberChatIds();
    const subscribersCount = subscribers.length;
    const connected = envConnected || subscribersCount > 0;
    return NextResponse.json({
      connected,
      envConnected,
      subscribersCount,
    });
  } catch {
    return NextResponse.json({ connected: false, envConnected: false, subscribersCount: 0 });
  }
}
