import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import Link from 'next/link';
import {
  Cpu,
  Activity,
  Brain,
  ArrowRight,
  Shield,
  BookOpen,
  Database,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * THE ENGINE ROOM HUB — /ops
 *
 * Separated from the Quantum War Room (/admin/quantum) which focuses on active trading & MoE debate.
 * This page is purely infrastructure + AI learning intelligence:
 *   - Full diagnostics → /ops/diagnostics (Redis/Postgres ping, NeuroPlasticity 7-expert matrix,
 *     CEO confidence threshold, Episodic Memory feed)
 *   - Simulation & backtest tools
 *   - PnL terminal
 */
export default async function OpsHubPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  const cards: Array<{
    href: string;
    icon: React.FC<{ className?: string }>;
    title: string;
    titleEn: string;
    description: string;
    highlight?: boolean;
  }> = [
    {
      href: '/ops/diagnostics',
      icon: Cpu,
      title: 'חדר המנועים',
      titleEn: 'ENGINE ROOM',
      description: 'בדיקת תשתית (Redis/Postgres), מטריצת NeuroPlasticity של 7 המומחים, סף הביטחון של CEO, ועדכוני הזיכרון האפיזודי.',
      highlight: true,
    },
    {
      href: '/ops/sandbox',
      icon: Shield,
      title: 'Sandbox & בדיקות',
      titleEn: 'SANDBOX',
      description: 'כלים לבדיקת הגדרות, סימולציה ידנית ובדיקת אינטגרציה.',
    },
    {
      href: '/ops/pnl',
      icon: Activity,
      title: 'PnL Terminal',
      titleEn: 'P&L',
      description: 'מסוף רווח והפסד — עקיבה אחר ביצועי טריידים.',
    },
    {
      href: '/ops/strategies',
      icon: Brain,
      title: 'אסטרטגיות',
      titleEn: 'STRATEGIES',
      description: 'ניהול וסקירת אסטרטגיות מסחר פעילות.',
    },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 pb-20" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12 space-y-8">

        {/* ── Header ─────────────────────────────────────────────────────────────────────────── */}
        <div className="border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-3 mb-2">
            <Database className="w-8 h-8 text-amber-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Operations Dashboard</h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                תשתית · Singularity Intelligence · כלי ניהול
              </p>
            </div>
          </div>
          <p className="text-sm text-zinc-400 max-w-2xl mt-3">
            לוח ה-Ops מופרד לחלוטין מחדר המלחמה Quantum (מסחר פעיל ודיון MoE). כאן תמצאו
            את בריאות השרתים, מטריצת ה-NeuroPlasticity של 7 המומחים, ולקחי הזיכרון האפיזודי.
          </p>
        </div>

        {/* ── Navigation Cards ────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cards.map(({ href, icon: Icon, title, titleEn, description, highlight }) => (
            <Link key={href} href={href}
              className={`group rounded-xl border p-5 transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                highlight
                  ? 'border-amber-500/40 bg-amber-950/10 hover:bg-amber-950/20 hover:border-amber-400/60'
                  : 'border-zinc-700/70 bg-zinc-900/60 hover:bg-zinc-800/60 hover:border-zinc-600'
              }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 mb-2">
                  <Icon className={`w-6 h-6 shrink-0 ${highlight ? 'text-amber-400' : 'text-zinc-400'}`} />
                  <div>
                    <p className="font-semibold text-zinc-100">{title}</p>
                    <p className={`text-[10px] font-mono tracking-widest ${highlight ? 'text-amber-500' : 'text-zinc-600'}`}>{titleEn}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 mt-1 shrink-0 transition-colors" />
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
            </Link>
          ))}
        </div>

        {/* ── Quick-links ──────────────────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            קישורים מהירים
          </h3>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/quantum"
              className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors border border-amber-500/30 rounded-lg px-3 py-1.5 hover:border-amber-400/50">
              <Activity className="w-3.5 h-3.5" />
              Quantum War Room →
            </Link>
            <Link href="/ops/diagnostics"
              className="flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100 transition-colors border border-zinc-700 rounded-lg px-3 py-1.5 hover:border-zinc-500">
              <Cpu className="w-3.5 h-3.5" />
              Engine Room / Diagnostics →
            </Link>
          </div>
          <p className="text-[11px] text-zinc-600 mt-3">
            הערה: לוח Quantum מציג מסחר פעיל + הצבעות 7 המומחים בזמן אמת.
            לוח Ops (כאן) מציג תשתית + NeuroPlasticity בלבד — ללא כפילות נתונים.
          </p>
        </div>
      </div>
    </main>
  );
}
