import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import Link from 'next/link';
import { ArrowRight, Activity, Clock, Gem, Scale, TrendingUp, BookOpen, Zap, Globe } from 'lucide-react';
import SettingsTelegramCard from '@/components/SettingsTelegramCard';
import ConfidenceVsRealityChart from '@/components/ConfidenceVsRealityChart';
import { getT } from '@/lib/i18n';
import { getScannerStatus, getStrategyDashboard, getMacroStatus } from '@/app/actions';

const t = getT('he');

function formatLastScan(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default async function SettingsPage() {
  if (isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
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
    <div className="min-h-screen bg-slate-900" dir="rtl">
      <header className="border-b border-slate-700 bg-slate-800/95">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link
            href="/ops"
            prefetch={true}
            className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-emerald-400 transition-colors"
          >
            <ArrowRight className="w-4 h-4" aria-hidden />
            חזרה ללוח הבקרה
          </Link>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-slate-100 mb-2">{t.botSettings}</h1>
        <p className="text-sm text-slate-400 mb-6 sm:mb-8">
          מרכז שליטה אסטרטגי — משקלים אוטומטיים, דיוק והתראות. ללא קלט ידני.
        </p>

        {/* Autonomous Mode: ACTIVE */}
        <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="מצב אוטונומי">
          <h2 className="text-lg font-semibold text-slate-200 mb-2 flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            מצב אוטונומי
          </h2>
          <p className="text-sm text-slate-300 flex items-center gap-2">
            <span className="inline-flex w-3 h-3 rounded-full bg-emerald-500" aria-hidden />
            <span className="font-medium text-emerald-400">פעיל</span>
            — האלגוריתם מתאים משקלים ומסריק את השוק אוטומטית.
          </p>
        </section>

        {/* Macro Pulse */}
        {macroStatus != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="פעימת מאקרו">
            <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Globe className="w-5 h-5 text-emerald-400" />
              פעימת מאקרו
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                <div className="text-xs text-slate-500 uppercase tracking-wide">מדד פחד ותאוות</div>
                <div className="text-lg font-semibold text-slate-100">
                  {macroStatus.fearGreedIndex} <span className="text-sm font-normal text-slate-400">({macroStatus.fearGreedClassification})</span>
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                <div className="text-xs text-slate-500 uppercase tracking-wide">דומיננטיות ביטקוין</div>
                <div className="text-lg font-semibold text-slate-100">{macroStatus.btcDominancePct}%</div>
              </div>
            </div>
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">סף כניסה פעיל:</span>{' '}
              <span className="font-medium text-emerald-400">{macroStatus.minimumConfidenceThreshold}%</span>
              {' — '}
              <span className="text-slate-200">{macroStatus.strategyLabelHe}</span>
            </p>
          </section>
        )}

        {/* Active weights + Last Auto-Tune */}
        {strategyDashboard != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="משקלים פעילים">
            <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-400" />
              משקלים פעילים (אלגוריתם ה-AI)
            </h2>
            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-3">
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                <div className="text-xs text-slate-500 uppercase tracking-wide">נפח</div>
                <div className="text-lg sm:text-xl font-semibold text-slate-100">
                  {Math.round(strategyDashboard.weights.volume * 100)}%
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                <div className="text-xs text-slate-500 uppercase tracking-wide">RSI</div>
                <div className="text-lg sm:text-xl font-semibold text-slate-100">
                  {Math.round(strategyDashboard.weights.rsi * 100)}%
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
                <div className="text-xs text-slate-500 uppercase tracking-wide">סנטימנט</div>
                <div className="text-lg sm:text-xl font-semibold text-slate-100">
                  {Math.round(strategyDashboard.weights.sentiment * 100)}%
                </div>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              עדכון אוטומטי אחרון: <span className="font-medium text-slate-200">{formatDateTime(strategyDashboard.lastAutoTuneAt)}</span>
            </p>
          </section>
        )}

        {/* Confidence vs Reality chart */}
        {strategyDashboard != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="התאמה בין התחזית למציאות">
            <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              התאמה: הסתברות מול מציאות
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              שיעור הצלחה לפי טווח הסתברות (מבוסס על נתונים היסטוריים).
            </p>
            <ConfidenceVsRealityChart data={strategyDashboard.accuracyByConfidence} />
          </section>
        )}

        {/* Log Lessons */}
        {strategyDashboard != null && strategyDashboard.weightChangeLog.length > 0 && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="לוג עדכוני משקלים">
            <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" />
              לוג לקחים — עדכוני משקלים
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              הסיבות לעדכוני המשקלים על ידי המערכת (אין צורך בשמירה ידנית).
            </p>
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {strategyDashboard.weightChangeLog.map((log) => (
                <li key={log.id} className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                  <span className="text-slate-500 text-xs block mb-1">{formatDateTime(log.created_at)}</span>
                  <span className="text-slate-200">{log.reason_he}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {scannerStatus != null && (
          <section className="mb-6 sm:mb-8 p-4 rounded-xl bg-slate-800/80 border border-slate-700" aria-label="סטטוס מערכת">
            <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              סטטוס מערכת — סורק השוק
            </h2>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-slate-300">
                <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                <span>סריקה אחרונה:</span>
                <span className="font-medium text-slate-100">{formatLastScan(scannerStatus.lastScanTime)}</span>
              </li>
              <li className="flex items-center gap-2 text-slate-300">
                <Gem className="w-4 h-4 text-slate-500 shrink-0" />
                <span>ג'מים שזוהו היום:</span>
                <span className="font-medium text-slate-100">{scannerStatus.gemsFoundToday}</span>
              </li>
              <li className="flex items-center gap-2 text-slate-300">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${scannerStatus.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-500'}`}
                    aria-hidden
                  />
                  {scannerStatus.status === 'ACTIVE' ? 'פעיל' : 'לא פעיל'}
                </span>
              </li>
              {scannerStatus.lastRunStats && (
                <li className="text-slate-400 text-xs mt-1">
                  מחזור אחרון: נסרקו {scannerStatus.lastRunStats.coinsChecked} מטבעות, נמצאו {scannerStatus.lastRunStats.gemsFound} ג'מים, נשלחו {scannerStatus.lastRunStats.alertsSent} התראות.
                </li>
              )}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              הסריקה מתבצעת אוטומטית על ידי אלגוריתם ה-AI כל 20 דקות.
            </p>
          </section>
        )}

        <SettingsTelegramCard />
      </main>
    </div>
  );
}
