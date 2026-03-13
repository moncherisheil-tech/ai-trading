'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Target,
  BarChart3,
  Loader2,
} from 'lucide-react';
import { useSimulation } from '@/context/SimulationContext';
import DashboardCard from '@/components/DashboardCard';
import AppHeader from '@/components/AppHeader';

interface VirtualSummary {
  totalVirtualBalancePct: number;
  winRatePct: number;
  dailyPnlPct: number;
  openCount: number;
  closedCount: number;
  openTrades: Array<{
    id: number;
    symbol: string;
    entry_price: number;
    amount_usd: number;
    entry_date: string;
    status: string;
  }>;
  closedTrades: Array<{
    id: number;
    symbol: string;
    entry_price: number;
    amount_usd: number;
    entry_date: string;
    closed_at: string | null;
    exit_price: number | null;
    pnl_pct: number | null;
  }>;
}

export default function PortfolioPage() {
  const { walletUsd, trades } = useSimulation();
  const [mounted, setMounted] = useState(false);
  const [virtual, setVirtual] = useState<VirtualSummary | null>(null);
  const [virtualLoading, setVirtualLoading] = useState(true);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch('/api/portfolio/virtual')
      .then((res) => res.json())
      .then((data) => setVirtual(data))
      .catch(() => setVirtual(null))
      .finally(() => setVirtualLoading(false));
  }, [mounted]);

  const allTrades = trades;
  const bySymbol = allTrades.reduce<Record<string, typeof trades>>((acc, t) => {
    if (!acc[t.symbol]) acc[t.symbol] = [];
    acc[t.symbol].push(t);
    return acc;
  }, {});

  if (!mounted) {
    return (
      <main className="min-h-screen bg-zinc-900" dir="rtl">
        <AppHeader />
        <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
          <div className="h-32 bg-zinc-800/80 rounded-2xl animate-pulse" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-900 text-zinc-100 overflow-x-hidden pb-24 sm:pb-8" dir="rtl">
      <AppHeader />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-zinc-100 flex items-center gap-3"
        >
          <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
            <Wallet className="w-6 h-6" />
          </span>
          תיק סימולציה
        </motion.h1>

        {/* Virtual P&L Dashboard (Hebrew) */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
            <Target className="w-5 h-5 text-amber-400" />
            מאזן וירטואלי (Paper Trading)
          </h2>
          {virtualLoading ? (
            <div className="rounded-2xl border border-zinc-700/80 bg-zinc-800/90 p-6 flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
              <span className="text-zinc-400">טוען נתוני תיק וירטואלי...</span>
            </div>
          ) : virtual && (virtual.openCount > 0 || virtual.closedCount > 0) ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <DashboardCard delay={0}>
                  <div className="p-4">
                    <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                      מאזן וירטואלי מצטבר
                    </div>
                    <div
                      className={`text-2xl font-bold ${
                        virtual.totalVirtualBalancePct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {(virtual.totalVirtualBalancePct >= 0 ? '+' : '') + virtual.totalVirtualBalancePct.toFixed(1)}%
                    </div>
                  </div>
                </DashboardCard>
                <DashboardCard delay={0.03}>
                  <div className="p-4">
                    <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                      אחוז הצלחה מצטבר
                    </div>
                    <div className="text-2xl font-bold text-amber-400">
                      {virtual.winRatePct.toFixed(0)}%
                    </div>
                  </div>
                </DashboardCard>
                <DashboardCard delay={0.06}>
                  <div className="p-4">
                    <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                      רווח/הפסד יומי
                    </div>
                    <div
                      className={`text-2xl font-bold ${
                        virtual.dailyPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {(virtual.dailyPnlPct >= 0 ? '+' : '') + virtual.dailyPnlPct.toFixed(1)}%
                    </div>
                  </div>
                </DashboardCard>
              </div>
              {(virtual.openTrades?.length > 0 || virtual.closedTrades?.length > 0) && (
                <DashboardCard delay={0.09}>
                  <div className="p-4">
                    <h3 className="text-sm font-semibold text-zinc-200 mb-3">פוזיציות וירטואליות</h3>
                    {virtual.openTrades?.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs text-zinc-500 mb-2">פתוחות</div>
                        <ul className="space-y-2">
                          {virtual.openTrades.map((t) => (
                            <li
                              key={t.id}
                              className="flex flex-wrap items-center justify-between gap-2 py-2 px-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60"
                            >
                              <span className="font-medium text-zinc-100">{t.symbol.replace('USDT', '')}</span>
                              <span className="text-zinc-400 text-sm">
                                ${t.entry_price.toLocaleString()} × ${t.amount_usd.toFixed(0)}
                              </span>
                              <span className="text-zinc-500 text-xs">
                                {new Date(t.entry_date).toLocaleString('he-IL')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {virtual.closedTrades?.length > 0 && (
                      <div>
                        <div className="text-xs text-zinc-500 mb-2">סגורות</div>
                        <ul className="space-y-2">
                          {virtual.closedTrades.slice(0, 15).map((t) => (
                            <li
                              key={t.id}
                              className="flex flex-wrap items-center justify-between gap-2 py-2 px-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60"
                            >
                              <span className="font-medium text-zinc-100">{t.symbol.replace('USDT', '')}</span>
                              <span className={t.pnl_pct != null && t.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {t.pnl_pct != null ? (t.pnl_pct >= 0 ? '+' : '') + t.pnl_pct.toFixed(1) + '%' : '—'}
                              </span>
                              <span className="text-zinc-500 text-xs">
                                {t.closed_at ? new Date(t.closed_at).toLocaleString('he-IL') : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </DashboardCard>
              )}
            </>
          ) : (
            <DashboardCard delay={0}>
              <div className="p-6 text-center text-zinc-400">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">אין עדיין עסקאות בתיק הוירטואלי. אשר סימולציה מתובנות AI או מהתראת טלגרם.</p>
              </div>
            </DashboardCard>
          )}
        </section>

        {/* Legacy simulation wallet */}
        <DashboardCard delay={0.05}>
          <div className="p-6 border-b border-zinc-700/80">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">יתרה נוכחית (סימולציה באתר)</div>
            <div className="text-3xl font-bold text-amber-400">
              ${walletUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </DashboardCard>

        {allTrades.length === 0 ? (
          <DashboardCard delay={0.1}>
            <div className="p-8 text-center text-zinc-400">
              <Wallet className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">אין עדיין עסקאות סימולציה. עבור לסריקה ובצע ניתוח ואז קנה/מכור.</p>
            </div>
          </DashboardCard>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-200">היסטוריית עסקאות</h2>
            {Object.entries(bySymbol).map(([symbol, symbolTrades], i) => (
              <DashboardCard key={symbol} delay={0.1 + i * 0.03}>
                <div className="p-4">
                  <div className="font-semibold text-zinc-100 mb-3">{symbol}</div>
                  <ul className="space-y-2">
                    {symbolTrades.slice(-20).reverse().map((tr) => (
                      <li
                        key={tr.id}
                        className="flex items-center justify-between gap-2 py-2 px-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60"
                      >
                        {tr.side === 'buy' ? (
                          <ArrowUpCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                        ) : (
                          <ArrowDownCircle className="w-5 h-5 text-red-400 shrink-0" />
                        )}
                        <span className={tr.side === 'buy' ? 'text-emerald-300' : 'text-red-300'}>
                          {tr.side === 'buy' ? 'קנייה' : 'מכירה'}
                        </span>
                        <span className="text-zinc-300">
                          ${tr.amountUsd.toFixed(0)} @ ${tr.price.toLocaleString()}
                        </span>
                        <span className="text-zinc-500 text-xs">{tr.dateLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </DashboardCard>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
