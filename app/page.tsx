import QuantumCommandCenter from '@/components/QuantumCommandCenter';

export const dynamic = 'force-dynamic';
/** Deep Execution: allow up to 60s for heavy server actions invoked from this route. */
export const maxDuration = 60;

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden pb-20 sm:pb-0 max-w-full">
      <QuantumCommandCenter />
    </main>
  );
}
