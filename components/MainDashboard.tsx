'use client';

import dynamic from 'next/dynamic';
import GemsStrip from '@/components/GemsStrip';

const CryptoAnalyzer = dynamic(() => import('@/components/CryptoAnalyzer'), {
  loading: () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12" dir="rtl">
      <div className="bg-zinc-800 border border-zinc-700 rounded-2xl p-8 text-sm text-zinc-400 animate-pulse">
        טוען מודול ניתוח...
      </div>
    </div>
  ),
});

/**
 * Shared dashboard content: GemsStrip + CryptoAnalyzer.
 * Used by both / (public) and /ops (auth-protected) for a unified experience.
 */
export default function MainDashboard() {
  return (
    <>
      <GemsStrip />
      <div className="py-4 sm:py-8 px-0">
        <CryptoAnalyzer />
      </div>
    </>
  );
}
