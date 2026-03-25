/**
 * Cron: Executive Weekly Report — PDF generator + placeholder email.
 * Fetches all closed trades from the last 7 days, computes weekly ROI and Win Rate,
 * and generates a styled "Executive Weekly Report" PDF. jspdf runs server-side only.
 * Authorization: CRON_SECRET (Bearer or query secret=).
 */

import { NextResponse } from 'next/server';
import { listClosedVirtualTradesInRange } from '@/lib/db/virtual-portfolio';
import { validateCronAuth } from '@/lib/cron-auth';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getLast7DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { from, to } = getLast7DaysRange();
    const trades = await listClosedVirtualTradesInRange(from, to);

    const totalTrades = trades.length;
    const wins = trades.filter((t) => (t.pnl_pct ?? 0) > 0).length;
    const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalAmountUsd = trades.reduce((s, t) => s + (t.amount_usd ?? 0), 0);
    const totalPnlUsd = trades.reduce((s, t) => s + ((t.amount_usd ?? 0) * (t.pnl_pct ?? 0)) / 100, 0);
    const weeklyRoiPct = totalAmountUsd > 0 ? (totalPnlUsd / totalAmountUsd) * 100 : 0;

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    doc.setFontSize(22);
    doc.text('Executive Weekly Report', 40, 40);
    doc.setFontSize(12);
    doc.text(`Period: ${new Date(from).toLocaleDateString('en-GB')} — ${new Date(to).toLocaleDateString('en-GB')}`, 40, 58);
    doc.setFontSize(10);
    doc.text(`Weekly ROI: ${weeklyRoiPct.toFixed(2)}%  |  Win Rate: ${winRatePct.toFixed(1)}%  |  Trades: ${totalTrades}`, 40, 74);

    const tableData = trades.map((t) => [
      t.symbol ?? '',
      (t.entry_price ?? 0).toFixed(2),
      (t.amount_usd ?? 0).toFixed(0),
      (t.pnl_pct ?? 0).toFixed(2) + '%',
      (t.close_reason ?? '—') as string,
      t.closed_at ? new Date(t.closed_at).toLocaleDateString() : '—',
    ]);
    autoTable(doc, {
      startY: 90,
      head: [['Symbol', 'Entry', 'Amount USD', 'PnL %', 'Close Reason', 'Date']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185] },
    });

    doc.setFontSize(9);
    let cursorY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 90;
    cursorY += 28;

    doc.setFontSize(11);
    doc.text('On-Chain Insights (6-Agent Board)', 40, cursorY);
    cursorY += 14;
    doc.setFontSize(9);
    doc.text(
      'Summary from On-Chain Sleuth (Agent 5): whale movements, Exchange Inflow/Outflow signals. See prediction details in app for per-symbol onchain_logic.',
      40,
      cursorY,
      { maxWidth: 520 }
    );
    cursorY += 24;

    doc.setFontSize(11);
    doc.text('Deep Memory Patterns (6-Agent Board)', 40, cursorY);
    cursorY += 14;
    doc.setFontSize(9);
    doc.text(
      'Summary from Deep Memory / Vector agent (Agent 6): similar historical trades (Pinecone), probability-of-success verdict. See prediction details in app for deep_memory_logic.',
      40,
      cursorY,
      { maxWidth: 520 }
    );
    cursorY += 28;

    doc.setFontSize(9);
    doc.text('Mon Chéri Quant AI — Enterprise 2.0 (6-Agent Board). Generated server-side.', 40, cursorY + 4);

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // Placeholder: email this PDF automatically (e.g. via Resend, SendGrid, or SES).
    // const emailSent = await sendWeeklyReportEmail(pdfBuffer, { weeklyRoiPct, winRatePct, totalTrades });
    // if (!emailSent) console.warn('[weekly-report] Email not configured or failed.');

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="executive-weekly-report.pdf"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron weekly-report]', message);
    await sendWorkerFailureAlert('weekly-report', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
