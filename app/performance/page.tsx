import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getBaseUrl } from '@/lib/config';
import PerformanceShowcase from '@/components/PerformanceShowcase';

/** All-time range for Performance Showcase: from epoch start of data to today. */
function getAllTimeRange() {
  const end = new Date();
  const start = new Date(2020, 0, 1, 0, 0, 0);
  return {
    from_date: start.toISOString(),
    to_date: end.toISOString(),
  };
}

async function fetchHistoricalAllTime() {
  const baseUrl = getBaseUrl();
  const { from_date, to_date } = getAllTimeRange();
  const cookieStore = await cookies();
  const response = await fetch(
    `${baseUrl}/api/ops/metrics/historical?from_date=${encodeURIComponent(from_date)}&to_date=${encodeURIComponent(to_date)}`,
    {
      cache: 'no-store',
      headers: { cookie: cookieStore.toString() },
    }
  );
  if (!response.ok) return null;
  return response.json();
}

const PERFORMANCE_TIMEOUT_MS = 8000;

export default async function PerformancePage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/performance');
    }
  }

  const data = await Promise.race([
    fetchHistoricalAllTime(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PERFORMANCE_TIMEOUT_MS)),
  ]);

  return (
    <main
      className="min-h-screen bg-[var(--app-bg,#030f1c)] text-[var(--app-text)] overflow-x-hidden pb-24 sm:pb-8"
      dir="rtl"
    >
      <PerformanceShowcase initialData={data} />
    </main>
  );
}
