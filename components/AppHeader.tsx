'use client';

import Link from 'next/link';
import { Activity, LineChart, Wallet } from 'lucide-react';
import LanguageToggle from '@/components/LanguageToggle';
import { useLocale } from '@/hooks/use-locale';
import { useSimulationOptional } from '@/context/SimulationContext';

export default function AppHeader() {
  const { t } = useLocale();
  const sim = useSimulationOptional();

  return (
    <header className="bg-zinc-800/95 border-b border-zinc-700 sticky top-0 z-10" dir="rtl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-500/90 rounded-lg flex items-center justify-center text-zinc-900 shadow-sm">
              <Activity className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-zinc-100 tracking-tight">{t.title}</h1>
          </div>
          <nav className="flex items-center gap-1">
            <Link
              href="/ops/pnl"
              prefetch={true}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
            >
              <LineChart className="w-4 h-4" />
              {t.pnlTerminal}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {sim && (
            <div className="hidden sm:flex items-center gap-1 text-xs font-medium text-amber-300 bg-zinc-700/80 px-3 py-1.5 rounded-full">
              <Wallet className="w-3.5 h-3.5" />
              <span>
                {sim.selectedSymbol} • $
                {sim.walletUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          <div className="text-sm font-medium text-zinc-400 bg-zinc-700/80 px-3 py-1.5 rounded-full">
            v1.0.0
          </div>
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
