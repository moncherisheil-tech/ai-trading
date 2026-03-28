import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import QuantumCommandCenter from '@/components/QuantumCommandCenter';
import SimulateBtcButton from '@/components/SimulateBtcButton';
import OpsMetricsBlock from '@/components/OpsMetricsBlock';
import EvaluatePredictionsButton from '@/components/EvaluatePredictionsButton';
import OverseerPanel from '@/components/OverseerPanel';
import { getT } from '@/lib/i18n';

const t = getT('he');

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  return (
    <main
      className="min-h-screen bg-[var(--background)] overflow-x-hidden pb-20 sm:pb-0"
      dir="rtl"
    >
      <QuantumCommandCenter />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-8 min-w-0 w-full">
        <section aria-label="לוח Overseer — Supreme Inspector">
          <OverseerPanel />
        </section>
        <section aria-label={t.simulationPerformance}>
          <SimulateBtcButton />
        </section>
        <section aria-label="הערכת תחזיות">
          <EvaluatePredictionsButton />
        </section>
        <section aria-label="מדדי מערכת">
          <OpsMetricsBlock />
        </section>
      </div>
    </main>
  );
}
