/**
 * Single source of truth for main app navigation.
 * Used by AppHeader (desktop + mobile drawer) and BottomNav so links stay identical.
 */

import type { ComponentType } from 'react';
import { Home, GraduationCap, LineChart, BarChart3, Settings, Cpu, Sparkles, Activity } from 'lucide-react';

export type NavLabelKey =
  | 'dashboard'
  | 'academy'
  | 'pnlTerminal'
  | 'performanceTrends'
  | 'quantumAi'
  | 'alphaSignals'
  | 'diagnostics'
  | 'settings';

export type NavItemConfig = {
  href: string;
  labelKey: NavLabelKey;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
};

export const NAV_ITEMS: NavItemConfig[] = [
  { href: '/', labelKey: 'dashboard', icon: Home },
  { href: '/academy', labelKey: 'academy', icon: GraduationCap },
  { href: '/ops/pnl', labelKey: 'pnlTerminal', icon: LineChart },
  { href: '/performance', labelKey: 'performanceTrends', icon: BarChart3 },
  { href: '/admin/quantum', labelKey: 'quantumAi', icon: Cpu },
  { href: '/admin/signals', labelKey: 'alphaSignals', icon: Sparkles },
  { href: '/ops/diagnostics', labelKey: 'diagnostics', icon: Activity },
  { href: '/settings', labelKey: 'settings', icon: Settings },
];

export function getNavLabel(item: NavItemConfig, t: Record<string, string>): string {
  return t[item.labelKey] ?? item.labelKey;
}
