'use client';

import { useState, useEffect, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import {
  Activity,
  Wallet,
  Menu,
  X,
  BookOpen,
  UserCircle2,
} from 'lucide-react';
import TelegramStatus from '@/components/TelegramStatus';
import ForexTicker from '@/components/ForexTicker';
import LogoutButton from '@/components/LogoutButton';
import { useLocale } from '@/hooks/use-locale';
import { useSimulationOptional } from '@/context/SimulationContext';
import { useMarketState } from '@/context/MarketStateContext';
import { NAV_ITEMS, getNavLabel } from '@/lib/nav-config';
import { getRiskPulseAction } from '@/app/actions';

type RiskLevel = 'green' | 'amber' | 'red';

function magnetMove(e: MouseEvent<HTMLElement>) {
  const target = e.currentTarget;
  const rect = target.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width - 0.5;
  const y = (e.clientY - rect.top) / rect.height - 0.5;
  target.style.transform = `translate3d(${x * 8}px, ${y * 8}px, 0)`;
}

function magnetReset(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.transform = 'translate3d(0,0,0)';
}

export default function AppHeader() {
  const { t } = useLocale();
  const pathname = usePathname();
  const sim = useSimulationOptional();
  const { isDefcon1 } = useMarketState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [riskPulse, setRiskPulse] = useState<RiskLevel>('green');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const out = await getRiskPulseAction();
        const data = out.success ? (out.data as { level?: RiskLevel }) : null;
        if (!cancelled && data?.level) setRiskPulse(data.level);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const isOpsArea = pathname.startsWith('/ops');
  const marketModeClass = riskPulse === 'red' ? 'market-mode-bear' : 'market-mode-bull';

  const isGuideActive = pathname === '/guide';
  return (
    <>
      {/* Desktop premium sidebar */}
      <motion.aside
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 100, damping: 20 }}
        className={`hidden md:flex md:sticky md:top-0 h-[100dvh] w-[280px] z-10 min-h-0 max-h-[100dvh] max-w-[280px] shrink-0 shadow-2xl overflow-x-hidden overflow-y-auto bg-[var(--app-surface)]/40 rounded-e-[2rem] ${marketModeClass} frosted-obsidian aside-sovereign-diamond backdrop-blur-[60px]`}
        style={{ boxShadow: '0 32px 60px rgba(0,0,0,0.58), 0 0 30px rgba(var(--market-border-rgb),0.24)' }}
        dir="rtl"
        aria-label="ניווט צדדי"
      >
        <div className="flex flex-col h-full min-h-0">
          <div className="h-16 px-4 flex items-center gap-3 border-b border-white/10 bg-[var(--app-surface)]/70 shrink-0">
            <Link
              href="/"
              className="flex items-center gap-3 min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded-lg"
              aria-label="דף הבית"
            >
              <div className="w-9 h-9 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] shrink-0">
                <Activity className="w-5 h-5" aria-hidden />
              </div>
              <h1 className="text-sm font-bold text-gray-100 tracking-tight truncate max-w-[180px] whitespace-nowrap">
                מסוף קוונטום · מון שרי
              </h1>
            </Link>
          </div>

          <div className="px-4 pb-2 shrink-0">
            <ForexTicker />
          </div>

          <nav className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-1" aria-label="ניווט ראשי">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const label = getNavLabel(item, t as Record<string, string>);
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onMouseMove={magnetMove}
                  onMouseLeave={magnetReset}
                  className={`magnet-link relative group flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                    isActive
                      ? 'text-amber-300 bg-white/10 border border-white/20'
                      : 'text-zinc-300 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/20'
                  } before:content-[''] before:absolute before:top-2 before:bottom-2 before:end-0 before:w-[3px] before:rounded-full before:transition-all ${
                    isActive
                      ? 'before:bg-amber-300/90 before:shadow-[0_0_22px_rgba(245,158,11,0.55)]'
                      : 'before:bg-transparent'
                  }`}
                  style={!isActive ? { boxShadow: '0 0 0 rgba(0,0,0,0)' } : { boxShadow: '0 0 22px rgba(var(--market-border-rgb),0.35)' }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}

            {/* Guide link */}
            <Link
              href="/guide"
              prefetch={true}
              onMouseMove={magnetMove}
              onMouseLeave={magnetReset}
              className={`magnet-link relative group flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                isGuideActive
                  ? 'text-amber-300 bg-white/10 border border-white/20'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/20'
              } before:content-[''] before:absolute before:top-2 before:bottom-2 before:end-0 before:w-[3px] before:rounded-full before:transition-all ${
                isGuideActive
                  ? 'before:bg-amber-300/90 before:shadow-[0_0_22px_rgba(245,158,11,0.55)]'
                  : 'before:bg-transparent'
              }`}
              aria-current={isGuideActive ? 'page' : undefined}
            >
              <BookOpen className="w-5 h-5 shrink-0" aria-hidden />
              <span className="truncate">מדריך למשתמש</span>
            </Link>
          </nav>

          <div className="p-4 border-t border-white/10 space-y-3">
            <div className="flex items-center gap-3 justify-between">
              <span className="text-xs text-zinc-500 font-medium">חשיפה</span>
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0"
                title={riskPulse === 'red' ? 'חשיפה קריטית' : riskPulse === 'amber' ? 'זהירות חשיפה' : 'סיכון תקין'}
                aria-label={riskPulse === 'red' ? 'חשיפה קריטית' : riskPulse === 'amber' ? 'זהירות חשיפה' : 'סיכון תקין'}
                style={{
                  backgroundColor: riskPulse === 'red' ? '#ef4444' : riskPulse === 'amber' ? '#f59e0b' : '#22c55e',
                  boxShadow:
                    riskPulse === 'red'
                      ? '0 0 12px rgba(239,68,68,0.4)'
                      : riskPulse === 'amber'
                        ? '0 0 12px rgba(245,158,11,0.4)'
                        : '0 0 12px rgba(34,197,94,0.4)',
                }}
              />
            </div>

            {sim && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/70 border border-zinc-700/50 text-amber-300/90 text-xs font-medium">
                <Wallet className="w-4 h-4 shrink-0" aria-hidden />
                <span className="truncate">
                  {sim.selectedSymbol} •{' '}
                  <span className="live-data-number tabular-nums">
                    ${sim.walletUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <Link
                href="/profile"
                className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                aria-label="פרופיל"
              >
                <UserCircle2 className="w-5 h-5 shrink-0" aria-hidden />
                <span className="truncate">פרופיל</span>
              </Link>
            </div>

            {isOpsArea && (
              <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <TelegramStatus />
                </div>
                <LogoutButton />
              </div>
            )}

            <div className="text-center text-[11px] text-zinc-500 tabular-nums">v1.3</div>
          </div>
        </div>
      </motion.aside>

      {/* Mobile header */}
      <header
        className="fixed top-0 inset-x-0 bg-[var(--app-surface)]/95 border-b border-[var(--app-border)] frosted-obsidian panel-sovereign-diamond z-50 shadow-[0_1px_0_0_rgba(255,255,255,0.05)] md:hidden overflow-x-hidden"
        dir="rtl"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 lg:gap-6 min-w-0">
          {/* Logo */}
          <div className="shrink-0 flex items-center gap-2 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              aria-label="דף הבית"
            >
              <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/30 rounded-lg flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] shrink-0">
                <Activity className="w-4 h-4" aria-hidden />
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className="hidden sm:flex w-3 h-3 rounded-full shrink-0"
              title={riskPulse === 'red' ? 'חשיפה קריטית' : riskPulse === 'amber' ? 'זהירות חשיפה' : 'סיכון תקין'}
              aria-label={riskPulse === 'red' ? 'חשיפה קריטית' : riskPulse === 'amber' ? 'זהירות חשיפה' : 'סיכון תקין'}
              style={{
                backgroundColor: riskPulse === 'red' ? '#ef4444' : riskPulse === 'amber' ? '#f59e0b' : '#22c55e',
                boxShadow:
                  riskPulse === 'red'
                    ? '0 0 12px rgba(239,68,68,0.4)'
                    : riskPulse === 'amber'
                      ? '0 0 12px rgba(245,158,11,0.4)'
                      : '0 0 12px rgba(34,197,94,0.4)',
              }}
            />

            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center justify-center w-10 h-10 rounded-lg text-zinc-400 hover:bg-zinc-800/80 hover:text-amber-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'סגור תפריט' : 'פתח תפריט'}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-[var(--z-drawer-backdrop)] bg-black/60 backdrop-blur-sm md:hidden"
              aria-hidden
              onClick={() => setMenuOpen(false)}
            />
            <div
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm z-[var(--z-drawer)] bg-[#0f0f0f] border-s border-white/10 shadow-2xl overflow-y-auto md:hidden flex flex-col"
              role="dialog"
              aria-modal="true"
              aria-label="תפריט ניווט"
              dir="rtl"
            >
              <div className="sticky top-0 flex items-center justify-between p-4 border-b border-white/10 bg-[#0f0f0f]/98 backdrop-blur shrink-0">
                <span className="text-sm font-semibold text-zinc-300">תפריט</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                  aria-label="סגור תפריט"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 flex flex-col gap-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const label = getNavLabel(item, t as Record<string, string>);
                  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={true}
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                        isActive
                          ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                          : 'text-zinc-300 hover:bg-white/5 hover:text-amber-400 border border-transparent'
                      }`}
                    >
                      <Icon className="w-5 h-5 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  );
                })}

                <Link
                  href="/guide"
                  prefetch={true}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                    isGuideActive
                      ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-amber-400 border border-transparent'
                  }`}
                  aria-current={isGuideActive ? 'page' : undefined}
                >
                  <BookOpen className="w-5 h-5 shrink-0" aria-hidden />
                  מדריך למשתמש
                </Link>
                {sim && (
                  <div className="flex items-center gap-2 px-4 py-3 mt-2 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-amber-300/90 text-sm font-medium">
                    <Wallet className="w-4 h-4 shrink-0" aria-hidden />
                    <span className="truncate">
                      {sim.selectedSymbol} •{' '}
                      <span className="live-data-number tabular-nums">
                        ${sim.walletUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </span>
                  </div>
                )}
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 min-h-[48px] mt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label="פרופיל"
                >
                  <UserCircle2 className="w-5 h-5 shrink-0" aria-hidden />
                  פרופיל
                </Link>
                <div className="flex items-center justify-between px-4 py-3 mt-4 pt-4 border-t border-white/5">
                  <span className="text-xs text-zinc-500">גרסה 1.3</span>
                </div>
                {isOpsArea && (
                  <div className="flex flex-col gap-3 px-4 py-4 mt-2 border-t border-white/10">
                    <TelegramStatus />
                    <LogoutButton />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </header>
    </>
  );
}
