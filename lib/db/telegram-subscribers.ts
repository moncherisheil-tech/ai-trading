/**
 * Multi-tenant Telegram subscribers for SaaS bot distribution.
 * Used when sending trade alerts and daily summaries to all active subscribers.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface TelegramSubscriber {
  id: number;
  chat_id: string;
  username: string | null;
  is_active: boolean;
  role: string;
  created_at: string | null;
  updated_at: string | null;
}

function hasPostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

/**
 * Returns all chat_ids of active subscribers. Used by telegram service to broadcast.
 * Falls back to empty array if Postgres is not configured or query fails.
 */
export async function listActiveSubscriberChatIds(): Promise<string[]> {
  if (!hasPostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT chat_id FROM telegram_subscribers WHERE is_active = true
    `;
    return (rows as { chat_id: string }[]).map((r) => r.chat_id).filter(Boolean);
  } catch (err) {
    console.error('[telegram-subscribers] listActiveSubscriberChatIds failed:', err);
    return [];
  }
}

/**
 * Returns full subscriber rows for admin UI (Subscribers tab).
 */
export async function listSubscribers(): Promise<TelegramSubscriber[]> {
  if (!hasPostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, chat_id, username, is_active, role, created_at, updated_at
      FROM telegram_subscribers ORDER BY id ASC
    `;
    return rows as TelegramSubscriber[];
  } catch (err) {
    console.error('[telegram-subscribers] listSubscribers failed:', err);
    return [];
  }
}

/**
 * Upsert a subscriber by chat_id. Used when user starts the bot or subscribes.
 */
export async function upsertSubscriber(params: {
  chat_id: string;
  username?: string | null;
  is_active?: boolean;
  role?: string;
}): Promise<TelegramSubscriber | null> {
  if (!hasPostgres()) return null;
  try {
    const { rows } = await sql`
      INSERT INTO telegram_subscribers (chat_id, username, is_active, role, updated_at)
      VALUES (${params.chat_id}, ${params.username ?? null}, ${params.is_active ?? true}, ${params.role ?? 'subscriber'}, CURRENT_TIMESTAMP)
      ON CONFLICT (chat_id) DO UPDATE SET
        username = COALESCE(EXCLUDED.username, telegram_subscribers.username),
        is_active = COALESCE(EXCLUDED.is_active, telegram_subscribers.is_active),
        role = COALESCE(EXCLUDED.role, telegram_subscribers.role),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, chat_id, username, is_active, role, created_at, updated_at
    `;
    return (rows[0] as TelegramSubscriber | undefined) ?? null;
  } catch (err) {
    console.error('[telegram-subscribers] upsertSubscriber failed:', err);
    return null;
  }
}

/**
 * Set is_active for a subscriber by chat_id.
 */
export async function setSubscriberActive(chatId: string, isActive: boolean): Promise<boolean> {
  if (!hasPostgres()) return false;
  try {
    await sql`
      UPDATE telegram_subscribers SET is_active = ${isActive}, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ${chatId}
    `;
    return true;
  } catch (err) {
    console.error('[telegram-subscribers] setSubscriberActive failed:', err);
    return false;
  }
}
