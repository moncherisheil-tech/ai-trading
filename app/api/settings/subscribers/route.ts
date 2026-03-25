import { NextResponse } from 'next/server';
import { listSubscribers, upsertSubscriber } from '@/lib/db/telegram-subscribers';

const CHAT_ID_REGEX = /^-?\d{1,20}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{1,32}$/;

function normalizeUsername(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.trim().replace(/^@+/, '');
  if (!s) return null;
  if (!USERNAME_REGEX.test(s)) return null;
  return s;
}

/**
 * GET: List all Telegram subscribers (for Settings Subscribers tab).
 * Admin/settings context only; protect via auth in production.
 */
export async function GET() {
  try {
    const subscribers = await listSubscribers();
    return NextResponse.json({ ok: true, subscribers });
  } catch (err) {
    console.error('[api/settings/subscribers]', err);
    return NextResponse.json({ ok: false, error: 'Failed to list subscribers' }, { status: 500 });
  }
}

/**
 * POST: Add or reactivate a subscriber (chat_id + optional username), is_active = true.
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'גוף הבקשה חייב להיות JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'גוף לא תקין' }, { status: 400 });
    }
    const { chat_id, username } = body as { chat_id?: unknown; username?: unknown };

    if (chat_id == null || (typeof chat_id !== 'string' && typeof chat_id !== 'number')) {
      return NextResponse.json({ ok: false, error: 'Chat ID נדרש' }, { status: 400 });
    }
    const chatIdStr = String(chat_id).trim();
    if (!chatIdStr || !CHAT_ID_REGEX.test(chatIdStr)) {
      return NextResponse.json(
        { ok: false, error: 'Chat ID לא תקין — צריך להיות מספר (למשל מזהה צ\'אט בטלגרם)' },
        { status: 400 }
      );
    }

    let usernameNorm: string | null = null;
    if (username !== undefined && username !== null && String(username).trim() !== '') {
      usernameNorm = normalizeUsername(username);
      if (!usernameNorm) {
        return NextResponse.json(
          { ok: false, error: 'שם משתמש לא תקין (אותיות באנגלית, מספרים ו־_, עד 32 תווים)' },
          { status: 400 }
        );
      }
    }

    const subscriber = await upsertSubscriber({
      chat_id: chatIdStr,
      username: usernameNorm,
      is_active: true,
      role: 'subscriber',
    });

    if (!subscriber) {
      return NextResponse.json(
        { ok: false, error: 'לא ניתן לשמור — ודא שמסד הנתונים מוגדר או נסה שוב' },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, subscriber });
  } catch (err) {
    console.error('[api/settings/subscribers] POST', err);
    return NextResponse.json({ ok: false, error: 'שגיאה בהוספת מנוי' }, { status: 500 });
  }
}
