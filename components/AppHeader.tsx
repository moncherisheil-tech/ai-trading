'use client';

import Link from 'next/link';
import { Activity, LineChart } from 'lucide-react';
import LanguageToggle from '@/components/LanguageToggle';
import { useLocale } from '@/hooks/use-locale';

export default function AppHeader() {
  const { t } = useLocale();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Activity className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{t.title}</h1>
          </div>
          <nav className="flex items-center gap-1">
            <Link
              href="/ops/pnl"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <LineChart className="w-4 h-4" />
              Finance & P&L
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
            v1.0.0
          </div>
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
