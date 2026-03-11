import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getBaseUrl } from '@/lib/config';
import SimulateBtcButton from '@/components/SimulateBtcButton';

async function getMetrics() {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/ops/metrics`, {
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

export default async function OpsPage() {
  if (isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  const metrics = await getMetrics();

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
        <SimulateBtcButton />
        {!metrics ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-red-600">Failed to load operational metrics.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Total Predictions</div><div className="text-2xl font-semibold text-slate-900">{metrics.db.total}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Pending</div><div className="text-2xl font-semibold text-amber-700">{metrics.db.pending}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Evaluated</div><div className="text-2xl font-semibold text-indigo-700">{metrics.db.evaluated}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Avg Latency</div><div className="text-2xl font-semibold text-slate-900">{metrics.quality.avgLatencyMs} ms</div></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Fallback Used</div><div className="text-2xl font-semibold text-slate-900">{metrics.quality.fallbackUsed}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Validation Repaired</div><div className="text-2xl font-semibold text-slate-900">{metrics.quality.repaired}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Audit Warnings</div><div className="text-2xl font-semibold text-amber-700">{metrics.audit.warnings}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Audit Errors</div><div className="text-2xl font-semibold text-red-700">{metrics.audit.errors}</div></div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
