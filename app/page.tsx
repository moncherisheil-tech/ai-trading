import { Suspense } from 'react';
import QuantumCommandCenter from '@/components/QuantumCommandCenter';

export const dynamic = 'force-dynamic';
/** Deep Execution: allow up to 60s for heavy server actions invoked from this route. */
export const maxDuration = 60;

function DashboardSkeleton() {
  return (
    <div className="min-h-screen p-4 sm:p-6 space-y-4 animate-pulse" dir="rtl" aria-busy="true" aria-label="טוען לוח בקרה">
      <div className="h-16 rounded-2xl bg-zinc-800/60" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="h-32 rounded-2xl bg-zinc-800/60" />
        <div className="h-32 rounded-2xl bg-zinc-800/60" />
        <div className="h-32 rounded-2xl bg-zinc-800/60" />
      </div>
      <div className="h-64 rounded-2xl bg-zinc-800/60" />
      <div className="h-48 rounded-2xl bg-zinc-800/60" />
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden pb-20 sm:pb-0 max-w-full">
      <Suspense fallback={<DashboardSkeleton />}>
        <QuantumCommandCenter />
      </Suspense>
    </main>
  );
}
