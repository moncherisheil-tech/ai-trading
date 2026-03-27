'use client';

import { useCallback, useId, useState } from 'react';
import { Crosshair, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

export type GodModeRiskLevel = 'institutional' | 'aggressive' | 'max_yield';

const RISK_LEVELS: {
  id: GodModeRiskLevel;
  emoji: string;
  title: string;
  subtitle: string;
}[] = [
  {
    id: 'institutional',
    emoji: '🛡️',
    title: 'Institutional',
    subtitle: 'שימור הון, סינון קפדני, סיכון נמוך',
  },
  {
    id: 'aggressive',
    emoji: '🚀',
    title: 'Aggressive',
    subtitle: 'מגמתיות, מצב קוונטי סטנדרטי, סיכון בינוני',
  },
  {
    id: 'max_yield',
    emoji: '☢️',
    title: 'Max Yield',
    subtitle: 'תנודתיות גבוהה, יעד 60%+ חודשי — פרופיל קיצוני',
  },
];

function parsePct(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.min(999.99, Math.max(0, n));
}

export default function RiskCommandCenter() {
  const baseId = useId();
  const [dailyRoiPct, setDailyRoiPct] = useState('0.5');
  const [weeklyRoiPct, setWeeklyRoiPct] = useState('2.5');
  const [monthlyRoiPct, setMonthlyRoiPct] = useState('8');
  const [riskLevel, setRiskLevel] = useState<GodModeRiskLevel>('aggressive');

  const onRoiChange = useCallback(
    (which: 'daily' | 'weekly' | 'monthly') => (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v === '' || /^-?\d*[.,]?\d*$/.test(v)) {
        if (which === 'daily') setDailyRoiPct(v);
        else if (which === 'weekly') setWeeklyRoiPct(v);
        else setMonthlyRoiPct(v);
      }
    },
    []
  );

  const onRoiBlur = useCallback(
    (which: 'daily' | 'weekly' | 'monthly') => () => {
      if (which === 'daily') setDailyRoiPct(String(parsePct(dailyRoiPct)));
      else if (which === 'weekly') setWeeklyRoiPct(String(parsePct(weeklyRoiPct)));
      else setMonthlyRoiPct(String(parsePct(monthlyRoiPct)));
    },
    [dailyRoiPct, weeklyRoiPct, monthlyRoiPct]
  );

  const groupId = `${baseId}-risk-dial`;

  return (
    <div
      className={cn(
        'relative rounded-2xl border bg-slate-900/95 text-slate-100 transition-[box-shadow,border-color] duration-500',
        riskLevel === 'max_yield'
          ? 'border-amber-500/35 shadow-[0_0_0_1px_rgba(251,191,36,0.22),0_0_48px_-12px_rgba(244,63,94,0.28),0_24px_80px_-24px_rgba(0,0,0,0.7)] ring-1 ring-amber-400/25 ring-offset-2 ring-offset-slate-950'
          : 'border-slate-700/90 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.65)] ring-0'
      )}
      dir="rtl"
    >
      {/* Max Yield: institutional danger zone — layered radiance, not flat neon */}
      {riskLevel === 'max_yield' && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-[0.14] [background:radial-gradient(ellipse_at_50%_0%,rgba(251,191,36,0.45),transparent_55%),radial-gradient(ellipse_at_80%_100%,rgba(244,63,94,0.35),transparent_50%)]"
          aria-hidden
        />
      )}

      <div className="relative overflow-hidden rounded-2xl">
        <div
          className={cn(
            'border-b px-4 py-4 sm:px-6 sm:py-5',
            riskLevel === 'max_yield'
              ? 'border-amber-500/25 bg-gradient-to-b from-amber-950/30 via-slate-900/80 to-slate-900'
              : 'border-slate-700/70 bg-slate-900/80'
          )}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-600/80 bg-slate-950/60 shadow-inner">
              <Crosshair className="h-5 w-5 text-cyan-400/90" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-lg font-semibold tracking-tight text-slate-50">God Mode — Risk &amp; ROI</h3>
                <span className="rounded-md border border-cyan-500/25 bg-cyan-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-cyan-300/90">
                  Local preview
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-400">
                יעדי תשואה ופרופיל סיכון לתצוגה בלבד — לוגיקת AI תחובר בשלב הבא.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-8 px-4 py-6 sm:px-6 sm:py-8">
          {/* ROI targets */}
          <section aria-labelledby={`${baseId}-roi-heading`}>
            <div className="mb-4 flex items-center gap-2">
              <Target className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <h4 id={`${baseId}-roi-heading`} className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
                יעדי ROI (%)
              </h4>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  { key: 'daily' as const, label: 'יומי', value: dailyRoiPct, suffix: 'Daily' },
                  { key: 'weekly' as const, label: 'שבועי', value: weeklyRoiPct, suffix: 'Weekly' },
                  { key: 'monthly' as const, label: 'חודשי', value: monthlyRoiPct, suffix: 'Monthly' },
                ] as const
              ).map((field) => (
                <div key={field.key} className="space-y-2">
                  <label
                    htmlFor={`${baseId}-roi-${field.key}`}
                    className="flex flex-col gap-0.5 text-start sm:flex-row sm:items-baseline sm:justify-between"
                  >
                    <span className="text-sm font-medium text-slate-200">{field.label}</span>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{field.suffix}</span>
                  </label>
                  <div className="relative">
                    <input
                      id={`${baseId}-roi-${field.key}`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      dir="ltr"
                      value={field.value}
                      onChange={onRoiChange(field.key)}
                      onBlur={onRoiBlur(field.key)}
                      className={cn(
                        'w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2.5 ps-3 pe-10 text-sm text-slate-100 tabular-nums tracking-tight',
                        'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
                        'focus:border-cyan-500/70 focus:outline-none focus:ring-1 focus:ring-cyan-500/50'
                      )}
                      aria-describedby={`${baseId}-roi-hint`}
                    />
                    <span
                      className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-medium text-slate-500 tabular-nums"
                      aria-hidden
                    >
                      %
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p id={`${baseId}-roi-hint`} className="mt-3 text-xs leading-relaxed text-slate-500">
              מספרים בפורמט עשרוני; הערכים בזיכרון הסשן בלבד (ללא שרת וללא שמירה לדיסק).
            </p>
          </section>

          {/* Risk dial — LTR spectrum for universal low → high mapping */}
          <section aria-labelledby={`${baseId}-risk-heading`}>
            <h4 id={`${baseId}-risk-heading`} className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">
              דיאל סובלנות סיכון
            </h4>
            <div dir="ltr" lang="en" className="rounded-2xl">
              <div
                id={groupId}
                role="radiogroup"
                aria-label="Risk tolerance"
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                {RISK_LEVELS.map((lvl) => {
                  const selected = riskLevel === lvl.id;
                  return (
                    <button
                      key={lvl.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setRiskLevel(lvl.id)}
                      onKeyDown={(e) => {
                        const idx = RISK_LEVELS.findIndex((x) => x.id === riskLevel);
                        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          const next = RISK_LEVELS[Math.min(RISK_LEVELS.length - 1, idx + 1)];
                          if (next) setRiskLevel(next.id);
                        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          const prev = RISK_LEVELS[Math.max(0, idx - 1)];
                          if (prev) setRiskLevel(prev.id);
                        }
                      }}
                      className={cn(
                        'group relative flex min-h-[120px] flex-col gap-2 rounded-xl border px-4 py-4 text-start transition-all duration-300',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
                        selected && lvl.id === 'institutional' && 'border-cyan-500/45 bg-gradient-to-b from-slate-900 to-slate-950 shadow-[inset_0_1px_0_rgba(34,211,238,0.12)]',
                        selected && lvl.id === 'aggressive' && 'border-violet-500/40 bg-gradient-to-b from-violet-950/40 to-slate-950 shadow-[0_0_32px_-12px_rgba(139,92,246,0.35)]',
                        selected && lvl.id === 'max_yield' &&
                          'border-amber-400/50 border-rose-500/35 bg-gradient-to-b from-amber-950/25 via-rose-950/20 to-slate-950 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.2),0_0_40px_-8px_rgba(251,113,133,0.35)]',
                        !selected && 'border-slate-700/80 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-900/50'
                      )}
                    >
                      <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-100">
                        <span className="text-lg leading-none" aria-hidden>
                          {lvl.emoji}
                        </span>
                        <span>{lvl.title}</span>
                      </span>
                      <span className="text-xs leading-snug text-slate-400 group-hover:text-slate-300">{lvl.subtitle}</span>
                      {selected && lvl.id === 'max_yield' && (
                        <span
                          className="pointer-events-none absolute inset-0 rounded-xl opacity-30 [background:linear-gradient(135deg,rgba(251,191,36,0.12),transparent_40%,rgba(244,63,94,0.1))]"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Summary strip — all numeric */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-xs text-slate-500">
            <span className="font-medium text-slate-400">סיכום מקומי</span>
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-slate-400 tabular-nums"
              dir="ltr"
            >
              <span>
                D <span className="text-slate-200">{parsePct(dailyRoiPct).toFixed(2)}</span>%
              </span>
              <span>
                W <span className="text-slate-200">{parsePct(weeklyRoiPct).toFixed(2)}</span>%
              </span>
              <span>
                M <span className="text-slate-200">{parsePct(monthlyRoiPct).toFixed(2)}</span>%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
