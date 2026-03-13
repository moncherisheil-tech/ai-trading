import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import MainDashboard from '@/components/MainDashboard';
import SimulateBtcButton from '@/components/SimulateBtcButton';
import OpsMetricsBlock from '@/components/OpsMetricsBlock';
import { getT } from '@/lib/i18n';

const t = getT('he');

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  if (isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  return (
    <main
      className="min-h-screen bg-zinc-900 overflow-x-hidden pb-20 sm:pb-0"
      dir="rtl"
    >
      <MainDashboard />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-8">
        <section aria-label={t.simulationPerformance}>
          <SimulateBtcButton />
        </section>
        <section aria-label="מדדי מערכת">
          <OpsMetricsBlock />
        </section>
      </div>
    </main>
  );
}
