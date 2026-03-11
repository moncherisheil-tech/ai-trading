import Link from 'next/link';
import { LayoutDashboard, BarChart3, LineChart } from 'lucide-react';
import LogoutButton from '@/components/LogoutButton';

export default function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/ops" className="flex items-center gap-2 text-slate-700 hover:text-indigo-600 transition-colors">
              <LayoutDashboard className="w-4 h-4" /> Ops Dashboard
            </Link>
            <Link href="/ops/strategies" className="flex items-center gap-2 text-slate-700 hover:text-indigo-600 transition-colors">
              <BarChart3 className="w-4 h-4" /> Strategy Insights
            </Link>
            <Link href="/ops/pnl" className="flex items-center gap-2 text-slate-700 hover:text-indigo-600 transition-colors">
              <LineChart className="w-4 h-4" /> P&L Terminal
            </Link>
          </nav>
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
