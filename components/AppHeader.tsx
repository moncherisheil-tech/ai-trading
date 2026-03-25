'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Wallet,
  Menu,
  X,
  BookOpen,
  UserCircle2,
  LayoutDashboard,
  BarChart3,
  LineChart,
  TrendingUp,
  Settings,
  Sparkles,
} from 'lucide-react';
import TelegramStatus from '@/components/TelegramStatus';
import LogoutButton from '@/components/LogoutButton';
import LanguageToggle from '@/components/LanguageToggle';
import { useLocale } from '@/hooks/use-locale';
import { useSimulationOptional } from '@/context/SimulationContext';
import { NAV_ITEMS, getNavLabel } from '@/lib/nav-config';

type RiskLevel = 'green' | 'amber' | 'red';

export default function AppHeader() {
  const { t, locale, isRtl } = useLocale();
  const pathname = usePathname();
  const sim = useSimulationOptional();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [riskPulse, setRiskPulse] = useState<RiskLevel>('green');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ops/risk-pulse', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { level?: RiskLevel } | null) => {
        if (!cancelled && data?.level) setRiskPulse(data.level);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  useEffect(() => {
    const w = sidebarCollapsed ? '92px' : '280px';
    document.documentElement.style.setProperty('--app-sidebar-width', w);
  }, [sidebarCollapsed]);

  const isOpsArea = pathname.startsWith('/ops');

  const isGuideActive = pathname === '/guide';
  const isDiagnosticsActive = pathname === '/ops/diagnostics';
  const diagnosticsHref = '/ops/diagnostics';

  return (
    <>
      {/* Desktop premium sidebar */}
      <aside
        className={`hidden md:flex fixed top-0 ${isRtl ? 'end-0 border-s' : 'start-0 border-e'} bottom-0 z-[var(--z-header)] backdrop-blur-2xl shadow-2xl overflow-hidden border-[var(--app-border)] bg-[var(--app-surface)]/92 transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-[92px]' : 'w-[280px]'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
        aria-label={locale === 'he' ? 'ניווט צדדי' : 'Sidebar navigation'}
      >
        <div className="flex flex-col h-full">
          <div className="h-16 px-4 flex items-center justify-between gap-3 border-b border-white/10 bg-[var(--app-surface)]/70">
            <Link
              href="/"
              className="flex items-center gap-3 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded-lg"
              aria-label={locale === 'he' ? 'דף הבית' : 'Home'}
            >
              <div className="w-9 h-9 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] shrink-0">
                <Activity className="w-5 h-5" aria-hidden />
              </div>
              {!sidebarCollapsed && (
                <h1 className="text-sm font-bold text-gray-100 tracking-tight truncate max-w-[180px] whitespace-nowrap">
                  Quantum Crypto | Mon Chéri
                </h1>
              )}
            </Link>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-amber-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              aria-label={sidebarCollapsed ? (locale === 'he' ? 'הרחב סרגל ניווט' : 'Expand sidebar') : (locale === 'he' ? 'כווץ סרגל ניווט' : 'Collapse sidebar')}
            >
              {sidebarCollapsed ? <Menu className="w-5 h-5" /> : <X className="w-5 h-5" />}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1" aria-label={locale === 'he' ? 'ניווט ראשי' : 'Primary navigation'}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const label = getNavLabel(item, t as Record<string, string>);
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  title={sidebarCollapsed ? label : undefined}
                  className={`relative group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                    isActive
                      ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                      : 'text-zinc-300 hover:text-amber-400 hover:bg-amber-500/5 border border-transparent hover:border-amber-500/15'
                  } before:content-[''] before:absolute before:top-2 before:bottom-2 before:end-0 before:w-[3px] before:rounded-full before:transition-all ${
                    isActive
                      ? 'before:bg-amber-500/90 before:shadow-[0_0_22px_rgba(245,158,11,0.55)]'
                      : 'before:bg-transparent'
                  } ${sidebarCollapsed ? 'justify-center gap-0 px-3' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden />
                  {!sidebarCollapsed && <span className="truncate">{label}</span>}
                </Link>
              );
            })}

            {/* Diagnostics (אבחון) */}
            <Link
              href={diagnosticsHref}
              prefetch={true}
              title={sidebarCollapsed ? (locale === 'he' ? 'אבחון' : 'Diagnostics') : undefined}
              className={`relative group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                isDiagnosticsActive
                  ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                  : 'text-zinc-300 hover:text-amber-400 hover:bg-amber-500/5 border border-transparent hover:border-amber-500/15'
              } before:content-[''] before:absolute before:top-2 before:bottom-2 before:end-0 before:w-[3px] before:rounded-full before:transition-all ${
                isDiagnosticsActive
                  ? 'before:bg-amber-500/90 before:shadow-[0_0_22px_rgba(245,158,11,0.55)]'
                  : 'before:bg-transparent'
              } ${sidebarCollapsed ? 'justify-center gap-0 px-3' : ''}`}
              aria-current={isDiagnosticsActive ? 'page' : undefined}
            >
              <Activity className="w-5 h-5 shrink-0" aria-hidden />
              {!sidebarCollapsed && <span className="truncate">{locale === 'he' ? 'אבחון' : 'Diagnostics'}</span>}
            </Link>

            {isOpsArea && (
              <>
                {!sidebarCollapsed && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/80">
                    {locale === 'he' ? 'ניהול Ops' : 'Ops Management'}
                  </div>
                )}
                {[
                  { href: '/ops', label: locale === 'he' ? 'לוח בקרה' : 'Dashboard', icon: LayoutDashboard },
                  { href: '/ops/diagnostics', label: locale === 'he' ? 'אבחון' : 'Diagnostics', icon: Activity },
                  { href: '/ops/strategies', label: t.strategyInsights ?? 'אסטרטגיות', icon: BarChart3 },
                  { href: '/ops/pnl', label: t.pnlTerminal ?? 'PnL', icon: LineChart },
                  { href: '/admin/quantum', label: t.quantumAi ?? 'Quantum AI', icon: Cpu },
                  { href: '/admin/signals', label: t.alphaSignals ?? 'Alpha Signals', icon: Sparkles },
                  { href: '/performance', label: locale === 'he' ? 'ביצועים' : 'Performance', icon: TrendingUp },
                  { href: '/settings', label: t.settings ?? 'הגדרות', icon: Settings },
                ].map(({ href, label, icon: Icon }) => {
                  const norm = pathname.replace(/\/$/, '') || '/';
                  const active =
                    href === '/ops'
                      ? norm === '/ops'
                      : norm === href || norm.startsWith(href + '/');
                  return (
                    <Link
                      key={href}
                      href={href}
                      prefetch={true}
                      title={sidebarCollapsed ? label : undefined}
                      className={`relative group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                        active
                          ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                          : 'text-zinc-300 hover:text-amber-400 hover:bg-amber-500/5 border border-transparent hover:border-amber-500/15'
                      } before:content-[''] before:absolute before:top-2 before:bottom-2 before:end-0 before:w-[3px] before:rounded-full before:transition-all ${
                        active
                          ? 'before:bg-amber-500/90 before:shadow-[0_0_22px_rgba(245,158,11,0.55)]'
                          : 'before:bg-transparent'
                      } ${sidebarCollapsed ? 'justify-center gap-0 px-3' : ''}`}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className="w-5 h-5 shrink-0" aria-hidden />
                      {!sidebarCollapsed && <span className="truncate">{label}</span>}
                    </Link>
                  );
                })}
              </>
            )}

            {/* Guide link */}
            <Link
              href="/guide"
              prefetch={true}
              title={sidebarCollapsed ? (locale === 'he' ? 'מדריך למשתמש' : 'User Guide') : undefined}
              className={`relative group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                isGuideActive
                  ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                  : 'text-zinc-300 hover:text-amber-400 hover:bg-amber-500/5 border border-transparent hover:border-amber-500/15'
              } before:content-[''] before:absolute before:top-2 before:bottom-2 before:end-0 before:w-[3px] before:rounded-full before:transition-all ${
                isGuideActive
                  ? 'before:bg-amber-500/90 before:shadow-[0_0_22px_rgba(245,158,11,0.55)]'
                  : 'before:bg-transparent'
              } ${sidebarCollapsed ? 'justify-center gap-0 px-3' : ''}`}
              aria-current={isGuideActive ? 'page' : undefined}
            >
              <BookOpen className="w-5 h-5 shrink-0" aria-hidden />
              {!sidebarCollapsed && <span className="truncate">{locale === 'he' ? 'מדריך למשתמש' : 'User Guide'}</span>}
            </Link>
          </nav>

          <div className="p-3 border-t border-white/10 space-y-3">
            <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
              {!sidebarCollapsed && (
                <span className="text-xs text-zinc-500 font-medium">{locale === 'he' ? 'חשיפה' : 'Exposure'}</span>
              )}
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0"
                title={riskPulse === 'red' ? (locale === 'he' ? 'חשיפה קריטית' : 'Critical exposure') : riskPulse === 'amber' ? (locale === 'he' ? 'זהירות חשיפה' : 'Exposure caution') : (locale === 'he' ? 'סיכון תקין' : 'Risk stable')}
                aria-label={riskPulse === 'red' ? (locale === 'he' ? 'חשיפה קריטית' : 'Critical exposure') : riskPulse === 'amber' ? (locale === 'he' ? 'זהירות חשיפה' : 'Exposure caution') : (locale === 'he' ? 'סיכון תקין' : 'Risk stable')}
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

            {sim && !sidebarCollapsed && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/70 border border-zinc-700/50 text-amber-300/90 text-xs font-medium">
                <Wallet className="w-4 h-4 shrink-0" aria-hidden />
                <span className="truncate">
                  {sim.selectedSymbol} • ${sim.walletUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <div className={`flex ${sidebarCollapsed ? 'justify-center' : 'justify-between'} items-center`}>
              <Link
                href="/profile"
                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm font-semibold ${
                  sidebarCollapsed
                    ? 'justify-center'
                    : 'text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50'
                } ${sidebarCollapsed ? 'text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50' : ''}`}
                aria-label={locale === 'he' ? 'פרופיל' : 'Profile'}
              >
                <UserCircle2 className="w-5 h-5 shrink-0" aria-hidden />
                {!sidebarCollapsed && <span className="truncate">{locale === 'he' ? 'פרופיל' : 'Profile'}</span>}
              </Link>
              <div className={sidebarCollapsed ? 'px-1' : ''}>
                <LanguageToggle />
              </div>
            </div>

            {isOpsArea && !sidebarCollapsed && (
              <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <TelegramStatus />
                </div>
                <LogoutButton />
              </div>
            )}
            {isOpsArea && sidebarCollapsed && (
              <div className="flex flex-col items-center gap-2 pt-2 border-t border-white/5">
                <TelegramStatus />
                <LogoutButton />
              </div>
            )}

            {!sidebarCollapsed && (
              <div className="text-center text-[11px] text-zinc-500">v1.3</div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header
        className="fixed top-0 inset-x-0 bg-[var(--app-surface)]/95 border-b border-[var(--app-border)] backdrop-blur-xl z-50 shadow-[0_1px_0_0_rgba(255,255,255,0.05)] md:hidden"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 lg:gap-6 min-w-0">
          {/* Logo */}
          <div className="shrink-0 flex items-center gap-2 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              aria-label={locale === 'he' ? 'דף הבית' : 'Home'}
            >
              <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/30 rounded-lg flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(34,197,94,0.3)] shrink-0">
                <Activity className="w-4 h-4" aria-hidden />
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className="hidden sm:flex w-3 h-3 rounded-full shrink-0"
              title={riskPulse === 'red' ? (locale === 'he' ? 'חשיפה קריטית' : 'Critical exposure') : riskPulse === 'amber' ? (locale === 'he' ? 'זהירות חשיפה' : 'Exposure caution') : (locale === 'he' ? 'סיכון תקין' : 'Risk stable')}
              aria-label={riskPulse === 'red' ? (locale === 'he' ? 'חשיפה קריטית' : 'Critical exposure') : riskPulse === 'amber' ? (locale === 'he' ? 'זהירות חשיפה' : 'Exposure caution') : (locale === 'he' ? 'סיכון תקין' : 'Risk stable')}
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

            <div className="shrink-0">
              <LanguageToggle />
            </div>

            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center justify-center w-10 h-10 rounded-lg text-zinc-400 hover:bg-zinc-800/80 hover:text-amber-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? (locale === 'he' ? 'סגור תפריט' : 'Close menu') : (locale === 'he' ? 'פתח תפריט' : 'Open menu')}
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
              className={`fixed top-0 ${isRtl ? 'end-0 border-s' : 'start-0 border-e'} bottom-0 w-full max-w-sm z-[var(--z-drawer)] bg-[#0f0f0f] border-white/10 shadow-2xl overflow-y-auto md:hidden flex flex-col`}
              role="dialog"
              aria-modal="true"
              aria-label={locale === 'he' ? 'תפריט ניווט' : 'Navigation menu'}
            >
              <div className="sticky top-0 flex items-center justify-between p-4 border-b border-white/10 bg-[#0f0f0f]/98 backdrop-blur shrink-0">
                <span className="text-sm font-semibold text-zinc-300">{locale === 'he' ? 'תפריט' : 'Menu'}</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                  aria-label={locale === 'he' ? 'סגור תפריט' : 'Close menu'}
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

            {!isOpsArea && (
            <Link
              href={diagnosticsHref}
              prefetch={true}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                isDiagnosticsActive
                  ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                  : 'text-zinc-300 hover:bg-white/5 hover:text-amber-400 border border-transparent'
              }`}
              aria-current={isDiagnosticsActive ? 'page' : undefined}
            >
              <Activity className="w-5 h-5 shrink-0" aria-hidden />
              {locale === 'he' ? 'אבחון' : 'Diagnostics'}
            </Link>
            )}

                {isOpsArea && (
                  <>
                    <div className="px-4 py-2 mt-2 text-[10px] font-bold uppercase tracking-widest text-amber-500/70 border-t border-white/10 pt-4">
                      {locale === 'he' ? 'ניהול Ops' : 'Ops Management'}
                    </div>
                    {[
                      { href: '/ops', label: locale === 'he' ? 'לוח בקרה' : 'Dashboard', icon: LayoutDashboard },
                      { href: '/ops/diagnostics', label: locale === 'he' ? 'אבחון' : 'Diagnostics', icon: Activity },
                      { href: '/ops/strategies', label: t.strategyInsights ?? 'אסטרטגיות', icon: BarChart3 },
                      { href: '/ops/pnl', label: t.pnlTerminal ?? 'PnL', icon: LineChart },
                      { href: '/admin/quantum', label: t.quantumAi ?? 'Quantum AI', icon: Cpu },
                      { href: '/admin/signals', label: t.alphaSignals ?? 'Alpha Signals', icon: Sparkles },
                      { href: '/performance', label: locale === 'he' ? 'ביצועים' : 'Performance', icon: TrendingUp },
                      { href: '/settings', label: t.settings ?? 'הגדרות', icon: Settings },
                    ].map(({ href, label, icon: Icon }) => {
                      const norm = pathname.replace(/\/$/, '') || '/';
                      const active =
                        href === '/ops'
                          ? norm === '/ops'
                          : norm === href || norm.startsWith(href + '/');
                      return (
                        <Link
                          key={href}
                          href={href}
                          prefetch={true}
                          onClick={() => setMenuOpen(false)}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                            active
                              ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                              : 'text-zinc-300 hover:bg-white/5 hover:text-amber-400 border border-transparent'
                          }`}
                        >
                          <Icon className="w-5 h-5 shrink-0" aria-hidden />
                          {label}
                        </Link>
                      );
                    })}
                    <div className="flex flex-col gap-3 px-4 py-4 mt-2 border-t border-white/10">
                      <TelegramStatus />
                      <LogoutButton />
                    </div>
                  </>
                )}

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
                  {locale === 'he' ? 'מדריך למשתמש' : 'User Guide'}
                </Link>
                {sim && (
                  <div className="flex items-center gap-2 px-4 py-3 mt-2 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-amber-300/90 text-sm font-medium">
                    <Wallet className="w-4 h-4 shrink-0" aria-hidden />
                    <span className="truncate">
                      {sim.selectedSymbol} • ${sim.walletUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 min-h-[48px] mt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label={locale === 'he' ? 'פרופיל' : 'Profile'}
                >
                  <UserCircle2 className="w-5 h-5 shrink-0" aria-hidden />
                  {locale === 'he' ? 'פרופיל' : 'Profile'}
                </Link>
                <div className="flex items-center justify-between px-4 py-3 mt-4 pt-4 border-t border-white/5">
                  <span className="text-xs text-zinc-500">{locale === 'he' ? 'גרסה v1.3' : 'Version v1.3'}</span>
                  <LanguageToggle />
                </div>
              </div>
            </div>
          </>
        )}
      </header>
    </>
  );
}
