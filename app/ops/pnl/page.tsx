import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getBaseUrl } from '@/lib/config';
import PnlTerminal from '@/components/PnlTerminal';

async function fetchPnl() {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/api/ops/metrics/pnl`, {
    cache: 'no-store',
    headers: {
      cookie: (await cookies()).toString(),
    },
  });
  if (!response.ok) return null;
  return response.json();
}

export default async function PnlOpsPage() {
  if (isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  const data = await fetchPnl();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <PnlTerminal data={data} />
      </div>
    </main>
  );
}
