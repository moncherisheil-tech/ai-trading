import { NextResponse } from 'next/server';
import { getLearningProgress } from '@/lib/ai-retrospective';
import { getLatestLearningReports } from '@/lib/db/learning-reports';
import { getAccuracySnapshots } from '@/lib/db/prediction-weights';
import { APP_CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/retrospective/insights
 * Returns latest Lessons Learned report and accuracy snapshots for Learning Progress dashboard.
 */
export async function GET(): Promise<NextResponse> {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return NextResponse.json({
      snapshots: [],
      latestReport: null,
      message: 'DB_DRIVER=sqlite required.',
    });
  }

  const snapshots = getAccuracySnapshots(30).map((s) => ({
    date: s.date,
    success_rate_pct: s.success_rate_pct,
  }));

  const reports = getLatestLearningReports(1);
  const latest = reports[0];

  return NextResponse.json({
    snapshots,
    latestReport: latest
      ? {
          successSummary: latest.success_summary_he,
          keyLesson: latest.key_lesson_he,
          actionTaken: latest.action_taken_he,
          accuracyPct: latest.accuracy_pct,
          created_at: latest.created_at,
        }
      : null,
  });
}
