/**
 * Executive Analysis (ניתוח מנהלים) for PDF reports.
 * GET /api/agent/insights/executive-analysis?from_date=ISO&to_date=ISO&win_rate_pct=&sharpe_ratio=&max_drawdown_pct=&total_pnl_pct=
 * Returns a professional Hebrew paragraph summarizing performance + agent insights for MD&A section.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAgentInsightsInRange } from '@/lib/db/agent-insights';
import { APP_CONFIG } from '@/lib/config';
import { generateLiveText } from '@/lib/ai-client';

function buildExecutiveAnalysisParagraph(params: {
  winRatePct: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number | null;
  totalPnlPct: number | null;
  insightSnippets: string[];
}): string {
  const { winRatePct, sharpeRatio, maxDrawdownPct, totalPnlPct, insightSnippets } = params;

  const parts: string[] = [];

  if (totalPnlPct != null && Number.isFinite(totalPnlPct)) {
    parts.push(
      totalPnlPct >= 0
        ? `בתקופה הנסקרת נרשמה תשואה מצטברת של ${totalPnlPct.toFixed(2)}%.`
        : `בתקופה הנסקרת נרשם הפסד מצטבר של ${Math.abs(totalPnlPct).toFixed(2)}%.`
    );
  }

  if (winRatePct != null && Number.isFinite(winRatePct)) {
    parts.push(`שיעור ההצלחה עמד על ${winRatePct.toFixed(1)}%.`);
  }

  if (sharpeRatio != null && Number.isFinite(sharpeRatio)) {
    if (sharpeRatio > 0) {
      parts.push(`מדד היציבות (שרפ) של ${sharpeRatio.toFixed(2)} משקף תשואה מותאמת סיכון חיובית.`);
    } else {
      parts.push(`מדד היציבות (שרפ) של ${sharpeRatio.toFixed(2)} מצביע על תנודתיות יחסית בתקופה.`);
    }
  }

  if (maxDrawdownPct != null && Number.isFinite(maxDrawdownPct)) {
    parts.push(`משיכה מקסימלית של ${maxDrawdownPct.toFixed(1)}% משקפת את עומק השפל מהשיא בתקופה.`);
  }

  if (insightSnippets.length > 0) {
    const central = insightSnippets.slice(0, 2).join(' ');
    parts.push(`תובנת הסוכן: ${central}`);
  }

  if (parts.length === 0) {
    return 'ניתוח מנהלים: לא זמינים מדדי ביצועים או תובנות סוכן לתקופה זו. הדוח מבוסס על נתונים היסטוריים למטרות לימוד וסימולציה בלבד.';
  }

  return parts.join(' ');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const winRatePctParam = searchParams.get('win_rate_pct');
    const sharpeRatioParam = searchParams.get('sharpe_ratio');
    const maxDrawdownPctParam = searchParams.get('max_drawdown_pct');
    const totalPnlPctParam = searchParams.get('total_pnl_pct');

    let insightSnippets: string[] = [];
    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from.getTime() <= to.getTime()) {
        const insights = await listAgentInsightsInRange(from.toISOString(), to.toISOString());
        insightSnippets = insights
          .slice(0, 3)
          .map((i) => i.insight?.trim())
          .filter(Boolean);
      }
    }

    const winRatePct =
      winRatePctParam != null && winRatePctParam !== '' ? parseFloat(winRatePctParam) : null;
    const sharpeRatio =
      sharpeRatioParam != null && sharpeRatioParam !== '' ? parseFloat(sharpeRatioParam) : null;
    const maxDrawdownPct =
      maxDrawdownPctParam != null && maxDrawdownPctParam !== ''
        ? parseFloat(maxDrawdownPctParam)
        : null;
    const totalPnlPct =
      totalPnlPctParam != null && totalPnlPctParam !== '' ? parseFloat(totalPnlPctParam) : null;

    const deterministicParagraph = buildExecutiveAnalysisParagraph({
      winRatePct: Number.isFinite(winRatePct) ? winRatePct : null,
      sharpeRatio: Number.isFinite(sharpeRatio) ? sharpeRatio : null,
      maxDrawdownPct: Number.isFinite(maxDrawdownPct) ? maxDrawdownPct : null,
      totalPnlPct: Number.isFinite(totalPnlPct) ? totalPnlPct : null,
      insightSnippets,
    });

    let analysis_he = deterministicParagraph;

    if (APP_CONFIG.isLiveMode) {
      const livePrompt = [
        'כתוב פסקת ניתוח מנהלים מקצועית בעברית (2-4 משפטים, ללא markdown).',
        'התבסס אך ורק על הנתונים הבאים, בלי להמציא עובדות:',
        JSON.stringify(
          {
            winRatePct: Number.isFinite(winRatePct) ? winRatePct : null,
            sharpeRatio: Number.isFinite(sharpeRatio) ? sharpeRatio : null,
            maxDrawdownPct: Number.isFinite(maxDrawdownPct) ? maxDrawdownPct : null,
            totalPnlPct: Number.isFinite(totalPnlPct) ? totalPnlPct : null,
            insightSnippets,
          },
          null,
          2
        ),
      ].join('\n');

      analysis_he = await generateLiveText({
        systemInstruction:
          'אתה אנליסט ביצועים בכיר בקרן גידור. כתוב בעברית רשמית ותמציתית, טון מקצועי מוסדי.',
        prompt: livePrompt,
        maxOutputTokens: 350,
        temperature: 0.2,
      });

      if (!analysis_he) {
        throw new Error('Executive analysis provider returned an empty response.');
      }
    }

    return NextResponse.json({ success: true, analysis_he });
  } catch (err) {
    console.error('[api/agent/insights/executive-analysis]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate executive analysis.',
        analysis_he:
          'ניתוח מנהלים: לא ניתן לטעון תובנות בתקופה זו. הדוח מבוסס על נתונים היסטוריים למטרות לימוד וסימולציה בלבד.',
      },
      { status: 500 }
    );
  }
}
