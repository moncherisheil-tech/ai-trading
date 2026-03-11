import dynamic from 'next/dynamic';
import AppHeader from '@/components/AppHeader';

const CryptoAnalyzer = dynamic(() => import('@/components/CryptoAnalyzer'), {
  loading: () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-sm text-slate-500 animate-pulse">
        Loading analyzer module...
      </div>
    </div>
  ),
});

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader />

      {/* Main Content */}
      <div className="py-8">
        <CryptoAnalyzer />
      </div>
    </main>
  );
}
