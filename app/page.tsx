import MainDashboard from '@/components/MainDashboard';

export const dynamic = 'force-dynamic';
/** Deep Execution: allow up to 60s for full AI consensus when user runs analysis from this page. */
export const maxDuration = 60;

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden pb-20 sm:pb-0 max-w-full">
      <MainDashboard />
    </main>
  );
}
