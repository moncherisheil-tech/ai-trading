/**
 * Production Launch Cleanup — Zero-State Initialization.
 * Clears agent_insights, virtual_portfolio, backtest_logs, scanner_alert_log.
 * Does NOT touch settings table (AppSettings / Command Center).
 * Resets scanner diagnostics and ticker cache. Optionally sends "System Online" to Telegram.
 *
 * Authorization: Bearer CRON_SECRET or PRODUCTION_CLEANUP_SECRET.
 * POST /api/ops/cleanup-production
 * Query: ?notify=1 to send Telegram launch message after cleanup.
 */

import { NextResponse } from 'next/server';
import { deleteAllAgentInsights } from '@/lib/db/agent-insights';
import { deleteAllVirtualTrades } from '@/lib/db/virtual-portfolio';
import { deleteAllBacktestLogs } from '@/lib/db/backtest-repository';
import { deleteAllScannerAlertLog } from '@/lib/db/scanner-alert-log';
import { resetScannerDiagnostics } from '@/lib/workers/market-scanner';
import { invalidateTickerCache } from '@/lib/cache-service';
import { sendTelegramMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LAUNCH_MESSAGE =
  '🚀 Smart Money v1.0 באוויר! המערכת מאותחלת, נקייה וסורקת כעת בשידור חי.';

export async function POST(request: Request): Promise<NextResponse> {
  const secret =
    process.env.PRODUCTION_CLEANUP_SECRET ||
    process.env.CRON_SECRET ||
    process.env.WORKER_CRON_SECRET ||
    '';
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const sendNotify = url.searchParams.get('notify') === '1';

  try {
    const [insights, portfolio, backtest, scannerLog] = await Promise.all([
      deleteAllAgentInsights(),
      deleteAllVirtualTrades(),
      deleteAllBacktestLogs(),
      deleteAllScannerAlertLog(),
    ]);

    resetScannerDiagnostics();
    invalidateTickerCache();

    let telegramSent = false;
    if (sendNotify) {
      const result = await sendTelegramMessage(LAUNCH_MESSAGE, { parse_mode: 'HTML' });
      telegramSent = result.ok;
    }

    return NextResponse.json({
      ok: true,
      message: 'Production cleanup completed. AppSettings (settings table) left intact.',
      deleted: {
        agent_insights: insights.deleted,
        virtual_portfolio: portfolio.deleted,
        backtest_logs: backtest.deleted,
        scanner_alert_log: scannerLog.deleted,
      },
      reset: ['scanner_diagnostics', 'ticker_cache'],
      telegram_launch_sent: sendNotify ? telegramSent : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cleanup-production] Error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
