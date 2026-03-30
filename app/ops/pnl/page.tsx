import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getBaseUrl } from '@/lib/config';
import PnlTerminal from '@/components/PnlTerminal';
import ManualTradeForm from '@/components/ManualTradeForm';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

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

const PNL_TIMEOUT_MS = 6000;

export default async function PnlOpsPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  const data = await Promise.race([
    fetchPnl(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PNL_TIMEOUT_MS)),
  ]);

  return (
    <main
      className="min-h-screen bg-[var(--background)] text-zinc-100 overflow-x-hidden max-w-full pb-20 sm:pb-6"
      dir="rtl"
    >
      <div className="max-w-7xl mx-auto min-w-0 w-full space-y-6 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <ManualTradeForm />
        <PnlTerminal data={data} />
      </div>
    </main>
  );
}
