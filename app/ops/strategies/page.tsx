import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getBaseUrl } from '@/lib/config';
import PerformanceTrendsCharts from '@/components/PerformanceTrendsCharts';
import TriggerRetrospectiveButton from '@/components/TriggerRetrospectiveButton';
import { getT } from '@/lib/i18n';

const t = getT('he');

async function fetchStrategies() {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/ops/strategies`, {
    cache: 'no-store',
    headers: {
      cookie: (await cookies()).toString(),
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function fetchAccuracyMetrics() {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/ops/metrics/accuracy`, {
    cache: 'no-store',
    headers: {
      cookie: (await cookies()).toString(),
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function updateInsightStatus(id: string, status: 'pending' | 'approved' | 'rejected') {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/ops/strategies`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      cookie: (await cookies()).toString(),
    },
    body: JSON.stringify({ id, status }),
  });
  return response.ok;
}

export default async function StrategyOpsPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  const [strategies, accuracy] = await Promise.all([fetchStrategies(), fetchAccuracyMetrics()]);

  const timeSeries = accuracy?.success && Array.isArray(accuracy.timeSeries) ? accuracy.timeSeries : [];
  const totalBacktests = accuracy?.totalBacktests ?? 0;
  const currentAccuracyPct = accuracy?.currentAccuracyPct ?? 0;
  const lastLearningCycleDate = accuracy?.lastLearningCycleDate ?? null;
  const totalStrategiesApproved = accuracy?.totalStrategiesApproved ?? 0;

  return (
    <main className="min-h-screen bg-[#050505] p-4 sm:p-6 overflow-x-hidden" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-zinc-100">{t.strategyInsights}</h1>
            <TriggerRetrospectiveButton label={t.runLearningCycle} />
          </div>
          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden />
            תחזיות תחת סנטימנט קיצוני מסומנות באזהרה ומקבלות הפחתת ביטחון 50%.
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-zinc-900/50 frosted-obsidian p-4 sm:p-6">
          <PerformanceTrendsCharts
            timeSeries={timeSeries}
            totalBacktests={totalBacktests}
            currentAccuracyPct={currentAccuracyPct}
            lastLearningCycleDate={lastLearningCycleDate}
            totalStrategiesApproved={totalStrategiesApproved}
          />
        </div>

        {!strategies || !strategies.success ? (
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 frosted-obsidian p-4 text-sm text-amber-400">
            {t.failedToLoadStrategies}
          </div>
        ) : strategies.data.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 frosted-obsidian p-4 text-sm text-zinc-500">
            {t.noStrategiesYet}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 frosted-obsidian overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead className="sticky top-0 z-[var(--z-sticky)] bg-zinc-900/95 backdrop-blur-[60px] border-b border-white/10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-500 text-end">נוצר</th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-500 text-end">סיכום דפוס</th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-500 text-end">כלל פעולה</th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-500 text-end">ביטחון</th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-500 text-end">סטטוס</th>
                    <th className="px-4 py-3 text-xs font-semibold text-zinc-500 text-end">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {(strategies.data as Array<{ id: string; created_at: string; pattern_summary: string; actionable_rule: string; confidence_score: number; status: string }>).map((item, idx) => (
                    <tr
                      key={item.id}
                      className={`border-b border-white/5 align-top hover:bg-white/[0.03] transition-colors ${idx % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
                    >
                      <td className="px-4 py-3 text-xs text-zinc-500 text-end tabular-nums" suppressHydrationWarning>
                        {new Date(item.created_at).toLocaleString('he-IL')}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-300 max-w-xs whitespace-pre-wrap text-end">
                        {item.pattern_summary}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-300 max-w-xs whitespace-pre-wrap text-end">
                        {item.actionable_rule}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400 text-end tabular-nums">
                        {(item.confidence_score * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-xs text-end">
                        <span
                          className={
                            item.status === 'approved'
                              ? 'inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-400'
                              : item.status === 'rejected'
                              ? 'inline-flex rounded-full bg-rose-500/20 px-2 py-0.5 text-rose-400'
                              : 'inline-flex rounded-full bg-zinc-600 px-2 py-0.5 text-zinc-400'
                          }
                        >
                          {item.status === 'approved' ? 'אושר' : item.status === 'rejected' ? 'נדחה' : item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-end space-x-2">
                        <form
                          action={async () => {
                            'use server';
                            await updateInsightStatus(item.id, 'approved');
                          }}
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                          >
                            {t.approve}
                          </button>
                        </form>
                        <form
                          action={async () => {
                            'use server';
                            await updateInsightStatus(item.id, 'rejected');
                          }}
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="rounded-lg bg-rose-500/20 border border-rose-500/30 px-2 py-1 text-xs font-medium text-rose-400 hover:bg-rose-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                          >
                            {t.reject}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

