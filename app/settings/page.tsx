import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import Link from 'next/link';
import { ArrowRight, Scale, TrendingUp, BookOpen, Zap, Globe } from 'lucide-react';
import SettingsCommandCenter from '@/components/SettingsCommandCenter';
import SystemOptimizationCard from '@/components/SystemOptimizationCard';
import ConfidenceVsRealityChart from '@/components/ConfidenceVsRealityChart';
import ScannerControlPanel from '@/components/ScannerControlPanel';
import OverseerBanner from '@/components/OverseerBanner';
import { getT } from '@/lib/i18n';
import { getScannerStatus, getStrategyDashboard, getMacroStatus } from '@/app/actions';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

const t = getT('he');

const EMPTY_DATETIME_LABEL = 'טרם עודכן';

function formatDateTime(iso: string | null): string {
  if (!iso) return EMPTY_DATETIME_LABEL;
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default async function SettingsPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login');
    }
  }

  let scannerStatus: Awaited<ReturnType<typeof getScannerStatus>> | null = null;
  let strategyDashboard: Awaited<ReturnType<typeof getStrategyDashboard>> | null = null;
  let macroStatus: Awaited<ReturnType<typeof getMacroStatus>> | null = null;
  try {
    [scannerStatus, strategyDashboard, macroStatus] = await Promise.all([
      getScannerStatus(),
      getStrategyDashboard(),
      getMacroStatus(),
    ]);
  } catch {
    // Auth or import failure — hide blocks
  }

  return (
    <div
      className="min-h-screen bg-zinc-950 text-zinc-100 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.08),transparent_50%)]"
      dir="rtl"
      data-theme="deep-sea"
    >
      <header className="border-b border-emerald-500/20 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <Link
            href="/ops"
            prefetch={true}
            className="flex items-center gap-2 text-sm font-medium text-emerald-200/90 hover:text-emerald-400 transition-colors"
          >
            <ArrowRight className="w-4 h-4" aria-hidden />
            חזרה ללוח הבקרה
          </Link>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-zinc-50 mb-2 tracking-tight">{t.botSettings}</h1>
        <p className="text-sm text-zinc-400 mb-4">
          מרכז פיקוד Mon Cheri — מסחר, בינה, טלגרם ותשתית. שמירה מאובטחת למסד הנתונים.
        </p>

        {/* Overseer live health — Master Command Center top banner */}
        <div className="mb-6 sm:mb-8">
          <OverseerBanner />
        </div>

        {/* Command Center: Risk, Scanner, System & UI */}
        <SettingsCommandCenter />

        {/* System Optimization — כיול מערכת אוטונומי */}
        <SystemOptimizationCard />

        {/* Autonomous Mode: ACTIVE */}
        <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-[#07192d]/80 border border-cyan-900/50" aria-label="מצב אוטונומי">
          <h2 className="text-lg font-semibold text-cyan-100 mb-2 flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            מצב אוטונומי
          </h2>
          <p className="text-sm text-cyan-200/90 flex items-center gap-2">
            <span className="inline-flex w-3 h-3 rounded-full bg-cyan-500" aria-hidden />
            <span className="font-medium text-cyan-400">פעיל</span>
            — האלגוריתם מתאים משקלים ומסריק את השוק אוטומטית.
          </p>
        </section>

        {/* Macro Pulse */}
        {macroStatus != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-[#07192d]/80 border border-cyan-900/50" aria-label="פעימת מאקרו">
            <h2 className="text-lg font-semibold text-cyan-100 mb-3 flex items-center gap-2">
              <Globe className="w-5 h-5 text-cyan-400" />
              פעימת מאקרו
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="bg-[#030f1c]/80 rounded-lg p-3 border border-cyan-900/50">
                <div className="text-xs text-cyan-500/80 uppercase tracking-wide">מדד פחד ותאוות</div>
                <div className="text-lg font-semibold text-cyan-50">
                  {macroStatus.fearGreedIndex} <span className="text-sm font-normal text-cyan-300/80">({macroStatus.fearGreedClassification})</span>
                </div>
              </div>
              <div className="bg-[#030f1c]/80 rounded-lg p-3 border border-cyan-900/50">
                <div className="text-xs text-cyan-500/80 uppercase tracking-wide">דומיננטיות ביטקוין</div>
                <div className="text-lg font-semibold text-cyan-50">{macroStatus.btcDominancePct}%</div>
              </div>
            </div>
            <p className="text-sm text-cyan-200/90">
              <span className="text-cyan-500/80">סף כניסה פעיל:</span>{' '}
              <span className="font-medium text-cyan-400">{macroStatus.minimumConfidenceThreshold}%</span>
              {' — '}
              <span className="text-cyan-200">{macroStatus.strategyLabelHe}</span>
            </p>
          </section>
        )}

        {/* Active weights + Last Auto-Tune */}
        {strategyDashboard != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-[#07192d]/80 border border-cyan-900/50" aria-label="משקלים פעילים">
            <h2 className="text-lg font-semibold text-cyan-100 mb-3 flex items-center gap-2">
              <Scale className="w-5 h-5 text-cyan-400" />
              משקלים פעילים (אלגוריתם ה-AI)
            </h2>
            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-3">
              <div className="bg-[#030f1c]/80 rounded-lg p-3 border border-cyan-900/50">
                <div className="text-xs text-cyan-500/80 uppercase tracking-wide">נפח</div>
                <div className="text-lg sm:text-xl font-semibold text-cyan-50">
                  {Math.round(strategyDashboard.weights.volume * 100)}%
                </div>
              </div>
              <div className="bg-[#030f1c]/80 rounded-lg p-3 border border-cyan-900/50">
                <div className="text-xs text-cyan-500/80 uppercase tracking-wide">RSI</div>
                <div className="text-lg sm:text-xl font-semibold text-cyan-50">
                  {Math.round(strategyDashboard.weights.rsi * 100)}%
                </div>
              </div>
              <div className="bg-[#030f1c]/80 rounded-lg p-3 border border-cyan-900/50">
                <div className="text-xs text-cyan-500/80 uppercase tracking-wide">סנטימנט</div>
                <div className="text-lg sm:text-xl font-semibold text-cyan-50">
                  {Math.round(strategyDashboard.weights.sentiment * 100)}%
                </div>
              </div>
            </div>
            <p className="text-sm text-cyan-400/80">
              עדכון אוטומטי אחרון: <span className="font-medium text-cyan-200">{formatDateTime(strategyDashboard.lastAutoTuneAt)}</span>
            </p>
          </section>
        )}

        {/* Confidence vs Reality chart */}
        {strategyDashboard != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-[#07192d]/80 border border-cyan-900/50" aria-label="התאמה בין התחזית למציאות">
            <h2 className="text-lg font-semibold text-cyan-100 mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              התאמה: הסתברות מול מציאות
            </h2>
            <p className="text-xs text-cyan-500/80 mb-3">
              שיעור הצלחה לפי טווח הסתברות (מבוסס על נתונים היסטוריים).
            </p>
            <ConfidenceVsRealityChart data={strategyDashboard.accuracyByConfidence} />
          </section>
        )}

        {/* Log Lessons */}
        {strategyDashboard != null && strategyDashboard.weightChangeLog.length > 0 && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-[#07192d]/80 border border-cyan-900/50" aria-label="לוג עדכוני משקלים">
            <h2 className="text-lg font-semibold text-cyan-100 mb-3 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" />
              לוג לקחים — עדכוני משקלים
            </h2>
            <p className="text-xs text-cyan-500/80 mb-3">
              הסיבות לעדכוני המשקלים על ידי המערכת (אין צורך בשמירה ידנית).
            </p>
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {strategyDashboard.weightChangeLog.map((log) => (
                <li key={log.id} className="text-sm text-cyan-200/90 bg-[#030f1c]/60 rounded-lg p-3 border border-cyan-900/40">
                  <span className="text-cyan-500/80 text-xs block mb-1">{formatDateTime(log.created_at)}</span>
                  <span className="text-cyan-100">{log.reason_he}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {scannerStatus != null && (
          <ScannerControlPanel
            initialData={{
              lastScanTime: scannerStatus.lastScanTime,
              gemsFoundToday: scannerStatus.gemsFoundToday,
              status: scannerStatus.status,
              lastRunStats: scannerStatus.lastRunStats,
              scanner_is_active: scannerStatus.scanner_is_active,
            }}
          />
        )}
      </main>
    </div>
  );
}
