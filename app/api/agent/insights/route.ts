import { NextRequest, NextResponse } from 'next/server';
import { listAgentInsights, listAgentInsightsInRange } from '@/lib/db/agent-insights';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/agent/insights
 * Returns agent insights for the Learning Center UI.
 * Optional: from_date, to_date (ISO) — when provided, returns insights in range (sync with CEO Briefing date range).
 * Default: last 50 rows.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from.getTime() <= to.getTime()) {
        const insights = await listAgentInsightsInRange(from.toISOString(), to.toISOString());
        return NextResponse.json({ success: true, insights });
      }
    }

    const insights = await listAgentInsights(50);
    return NextResponse.json({ success: true, insights });
  } catch (err) {
    console.error('[api/agent/insights]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load agent insights.', insights: [] },
      { status: 500 }
    );
  }
}
