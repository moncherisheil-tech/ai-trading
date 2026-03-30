import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getAppSettings, setAppSettings } from '@/lib/db/app-settings';
import { listRecentTradeExecutions, listRecentLearnedInsights } from '@/lib/db/execution-learning';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

async function toggleExecutionMode(formData: FormData) {
  'use server';
  const nextMode = String(formData.get('mode') || 'PAPER') === 'LIVE' ? 'LIVE' : 'PAPER';
  const current = await getAppSettings();
  await setAppSettings({
    execution: {
      ...current.execution,
      mode: nextMode,
    },
  });
  revalidatePath('/admin/execution');
}

export default async function ExecutionAdminPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/admin/execution');
    }
  }

  const [settings, executions, insights] = await Promise.all([
    getAppSettings(),
    listRecentTradeExecutions(30),
    listRecentLearnedInsights(30),
  ]);

  const isLive = settings.execution.mode === 'LIVE';

  return (
    <section className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold text-zinc-100 md:text-3xl">Execution Control Center</h1>
      <p className="mt-1 text-sm text-zinc-400">CEO risk console for PAPER/LIVE execution and AI learning loop.</p>

      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.04] p-4">
        <h2 className="text-lg font-medium text-zinc-100">Master Mode</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Current mode: <span className={isLive ? 'text-rose-300' : 'text-emerald-300'}>{isLive ? 'LIVE TRADING' : 'PAPER TRADING'}</span>
        </p>
        <form action={toggleExecutionMode} className="mt-4 flex gap-2">
          <button
            type="submit"
            name="mode"
            value="PAPER"
            className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20"
          >
            Switch to PAPER
          </button>
          <button
            type="submit"
            name="mode"
            value="LIVE"
            className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20"
          >
            Arm LIVE
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.04] p-4">
        <h2 className="text-lg font-medium text-zinc-100">Recent Executions</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="px-2 py-2">Symbol</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Side</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">PnL</th>
                <th className="px-2 py-2">Executed</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((row) => (
                <tr key={row.id} className="border-t border-white/10 text-zinc-200">
                  <td className="px-2 py-2">{row.symbol}</td>
                  <td className="px-2 py-2">{row.type}</td>
                  <td className="px-2 py-2">{row.side}</td>
                  <td className="px-2 py-2">{row.status}</td>
                  <td className={`px-2 py-2 ${(row.pnl ?? 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                    {row.pnl != null ? row.pnl.toFixed(4) : '--'}
                  </td>
                  <td className="px-2 py-2">{new Date(row.executed_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.04] p-4">
        <h2 className="text-lg font-medium text-zinc-100">Lessons Learned</h2>
        <ul className="mt-3 space-y-2">
          {insights.map((insight) => (
            <li key={insight.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
              <p>{insight.failure_reason}</p>
              <p className="mt-1 text-xs text-zinc-400">
                Ref: {insight.academy_reference ?? 'n/a'} | Adjusted: {insight.adjustment_applied ? 'YES' : 'NO'}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
