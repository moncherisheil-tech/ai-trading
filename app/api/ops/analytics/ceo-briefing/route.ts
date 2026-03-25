/**
 * CEO Briefing API — Hebrew period summary from agent_insights + optional metrics.
 * GET /api/ops/analytics/ceo-briefing?from_date=ISO&to_date=ISO&total_pnl_pct=&win_rate_pct=
 * If total_pnl_pct and win_rate_pct are provided, they are used in the summary; otherwise a generic summary is built from insights only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAgentInsightsInRange } from '@/lib/db/agent-insights';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';

function buildSummaryParagraph(
  insights: { insight: string }[],
  totalPnlPct: number | null,
  winRatePct: number | null
): string {
  const pnlStr =
    totalPnlPct != null
      ? `בתקופה זו המערכת הניבה ${totalPnlPct >= 0 ? '' : 'הפסד של '}${totalPnlPct.toFixed(1)}% ${totalPnlPct >= 0 ? 'רווח' : ''}.`
      : 'בתקופה זו לא חושבו מדדי רווח מרכזיים.';
  const winStr =
    winRatePct != null
      ? `שיעור ההצלחה עמד על ${winRatePct.toFixed(1)}%.`
      : '';
  const insightSnippets = insights.slice(0, 3).map((i) => i.insight?.trim()).filter(Boolean);
  const centralInsight =
    insightSnippets.length > 0
      ? `התובנה המרכזית של הסוכן: ${insightSnippets.join(' ')}`
      : 'אין תובנות סוכן בתקופה זו.';

  return `סיכום תקופתי: ${pnlStr} ${winStr} ${centralInsight}`.replace(/\s+/g, ' ').trim();
}

export async function GET(request: NextRequest) {
  if (isSessionEnabled()) {
    const token = request.cookies.get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');
  const totalPnlPctParam = searchParams.get('total_pnl_pct');
  const winRatePctParam = searchParams.get('win_rate_pct');

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { success: false, error: 'Missing from_date or to_date (ISO 8601).' },
      { status: 400 }
    );
  }

  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json(
      { success: false, error: 'Invalid from_date or to_date.' },
      { status: 400 }
    );
  }

  const totalPnlPct =
    totalPnlPctParam != null && totalPnlPctParam !== ''
      ? parseFloat(totalPnlPctParam)
      : null;
  const winRatePct =
    winRatePctParam != null && winRatePctParam !== ''
      ? parseFloat(winRatePctParam)
      : null;

  try {
    const insights = await listAgentInsightsInRange(fromDate, toDate);
    const summary_he = buildSummaryParagraph(
      insights.map((i) => ({ insight: i.insight })),
      Number.isFinite(totalPnlPct) ? totalPnlPct : null,
      Number.isFinite(winRatePct) ? winRatePct : null
    );

    return NextResponse.json({
      success: true,
      from_date: fromDate,
      to_date: toDate,
      summary_he,
      insights_count: insights.length,
    });
  } catch (err) {
    console.error('[ceo-briefing]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to generate CEO briefing.' },
      { status: 500 }
    );
  }
}
