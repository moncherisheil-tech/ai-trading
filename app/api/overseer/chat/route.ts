/**
 * POST /api/overseer/chat — Executive Chat with the System Overseer (Virtual COO).
 * Same AI logic as Telegram Executive Hotline: context + Gemini, response in professional Hebrew.
 * Requires admin session when session is enabled. Rate-limited to prevent abuse/API exhaustion.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getOverseerChatReply } from '@/lib/system-overseer';
import { allowDistributedRequest } from '@/lib/rate-limit-distributed';

export const dynamic = 'force-dynamic';

const CHAT_RATE_LIMIT = 15;
const CHAT_WINDOW_MS = 60 * 1000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get('app_auth_token')?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const headersList = await headers();
  const forwarded = headersList.get('x-forwarded-for');
  const ip = (forwarded?.split(',')[0]?.trim() || 'unknown').slice(0, 64);
  const rateKey = `overseer-chat:${ip}`;
  const allowed = await allowDistributedRequest(rateKey, CHAT_RATE_LIMIT, CHAT_WINDOW_MS);
  if (allowed === false) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  let body: { message?: string } = {};
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 });
  }

  try {
    const reply = await getOverseerChatReply(message);
    return NextResponse.json({ ok: true, reply });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Overseer chat failed';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
