import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getBaseUrl } from '@/lib/config';
import PerformanceTrendsCharts from '@/components/PerformanceTrendsCharts';
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

async function triggerLearning() {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/workers/learn`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      cookie: (await cookies()).toString(),
      authorization: process.env.WORKER_CRON_SECRET ? `Bearer ${process.env.WORKER_CRON_SECRET}` : '',
    },
  });
  return response.ok;
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
  if (isSessionEnabled()) {
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
    <main className="min-h-screen bg-slate-900 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-100">{t.strategyInsights}</h1>
            <form
            action={async () => {
              'use server';
              await triggerLearning();
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
            >
              {t.runLearningCycle}
            </button>
          </form>
          </div>
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden />
            תחזיות תחת סנטימנט קיצוני מסומנות באזהרה ומקבלות הפחתת ביטחון 50%.
          </p>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <PerformanceTrendsCharts
            timeSeries={timeSeries}
            totalBacktests={totalBacktests}
            currentAccuracyPct={currentAccuracyPct}
            lastLearningCycleDate={lastLearningCycleDate}
            totalStrategiesApproved={totalStrategiesApproved}
          />
        </div>

        {!strategies || !strategies.success ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-sm text-amber-400">
            {t.failedToLoadStrategies}
          </div>
        ) : strategies.data.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-sm text-slate-400">
            {t.noStrategiesYet}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500">Created</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500">Pattern Summary</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500">Actionable Rule</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500">Confidence</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-3 py-2 text-xs font-semibold text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {strategies.data.map((item: any) => (
                    <tr key={item.id} className="border-b border-slate-700 align-top">
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {new Date(item.created_at).toLocaleString('he-IL')}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-200 max-w-xs whitespace-pre-wrap">
                        {item.pattern_summary}
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-200 max-w-xs whitespace-pre-wrap">
                        {item.actionable_rule}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {(item.confidence_score * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={
                            item.status === 'approved'
                              ? 'inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-400'
                              : item.status === 'rejected'
                              ? 'inline-flex rounded-full bg-rose-500/20 px-2 py-0.5 text-rose-400'
                              : 'inline-flex rounded-full bg-slate-600 px-2 py-0.5 text-slate-400'
                          }
                        >
                          {item.status === 'approved' ? 'אושר' : item.status === 'rejected' ? 'נדחה' : item.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs space-x-2">
                        <form
                          action={async () => {
                            'use server';
                            await updateInsightStatus(item.id, 'approved');
                          }}
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
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
                            className="rounded bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-500"
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

