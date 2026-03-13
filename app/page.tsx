import AppHeader from '@/components/AppHeader';
import MainDashboard from '@/components/MainDashboard';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-900 overflow-x-hidden pb-20 sm:pb-0" dir="rtl">
      <AppHeader />
      <MainDashboard />
    </main>
  );
}
