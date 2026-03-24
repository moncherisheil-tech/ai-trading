import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { validateCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

type ComponentStatus = 'pass' | 'fail';

type ComponentResult = {
  status: ComponentStatus;
  details?: string;
  checks?: Record<string, boolean>;
};

function hasEnv(key: string): boolean {
  const value = process.env[key];
  return typeof value === 'string' && value.trim().length > 0;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json(
      { status: 'fail', error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const components: Record<string, ComponentResult> = {
    database: { status: 'fail' },
    environment: { status: 'fail' },
    externalSenses: { status: 'fail' },
    telegram: { status: 'fail' },
  };

  try {
    const selectOne = await sql`SELECT 1 AS ok`;
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'board_meeting_logs'
      ) AS board_meeting_logs_exists
    `;
    const select1Ok = Number((selectOne.rows?.[0] as { ok?: number })?.ok ?? 0) === 1;
    const boardMeetingLogsExists = Boolean(
      (tableCheck.rows?.[0] as { board_meeting_logs_exists?: boolean })?.board_meeting_logs_exists
    );
    components.database = {
      status: select1Ok && boardMeetingLogsExists ? 'pass' : 'fail',
      checks: {
        select1: select1Ok,
        boardMeetingLogsTableExists: boardMeetingLogsExists,
      },
      details: select1Ok && boardMeetingLogsExists ? 'Database integrity check passed' : 'Database check failed',
    };
  } catch (error: unknown) {
    components.database = {
      status: 'fail',
      details: error instanceof Error ? error.message : 'Database integrity check failed',
    };
  }

  try {
    const checks = {
      cronSecret: hasEnv('CRON_SECRET'),
      databaseUrl: hasEnv('DATABASE_URL') || hasEnv('POSTGRES_URL'),
      telegramBotToken: hasEnv('TELEGRAM_BOT_TOKEN'),
      telegramChatId: hasEnv('TELEGRAM_CHAT_ID'),
      llmApiKey: hasEnv('GEMINI_API_KEY') || hasEnv('GROQ_API_KEY'),
    };
    const ok = Object.values(checks).every(Boolean);
    components.environment = {
      status: ok ? 'pass' : 'fail',
      checks,
      details: ok ? 'Required environment variables are present' : 'One or more required env vars are missing',
    };
  } catch (error: unknown) {
    components.environment = {
      status: 'fail',
      details: error instanceof Error ? error.message : 'Environment check failed',
    };
  }

  try {
    const timeoutMs = 3000;
    const [binanceRes, dexRes, fearGreedRes] = await Promise.all([
      fetchWithTimeout('https://api.binance.com/api/v3/ping', timeoutMs),
      fetchWithTimeout('https://api.dexscreener.com/latest/dex/search?q=BTC', timeoutMs),
      fetchWithTimeout('https://api.alternative.me/fng/?limit=1', timeoutMs),
    ]);
    const checks = {
      binance: binanceRes.ok,
      dexScreener: dexRes.ok,
      fearGreed: fearGreedRes.ok,
    };
    const ok = Object.values(checks).every(Boolean);
    components.externalSenses = {
      status: ok ? 'pass' : 'fail',
      checks,
      details: ok ? 'External senses reachable' : 'One or more external senses unavailable',
    };
  } catch (error: unknown) {
    components.externalSenses = {
      status: 'fail',
      details: error instanceof Error ? error.message : 'External senses check failed',
    };
  }

  try {
    const token = typeof process.env.TELEGRAM_BOT_TOKEN === 'string' ? process.env.TELEGRAM_BOT_TOKEN.trim() : '';
    if (!token) {
      components.telegram = {
        status: 'fail',
        checks: { tokenPresent: false, apiReachable: false },
        details: 'TELEGRAM_BOT_TOKEN is missing',
      };
    } else {
      const telegramRes = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`, 3000);
      let apiOk = false;
      try {
        const payload = (await telegramRes.json()) as { ok?: boolean };
        apiOk = telegramRes.ok && payload?.ok === true;
      } catch {
        apiOk = false;
      }
      components.telegram = {
        status: apiOk ? 'pass' : 'fail',
        checks: { tokenPresent: true, apiReachable: apiOk },
        details: apiOk ? 'Telegram bot connectivity verified' : 'Telegram getMe failed',
      };
    }
  } catch (error: unknown) {
    components.telegram = {
      status: 'fail',
      details: error instanceof Error ? error.message : 'Telegram connectivity check failed',
    };
  }

  const allPass = Object.values(components).every((component) => component.status === 'pass');

  return NextResponse.json(
    {
      status: allPass ? 'pass' : 'fail',
      components,
      timestamp: new Date().toISOString(),
    },
    { status: allPass ? 200 : 503 }
  );
}
