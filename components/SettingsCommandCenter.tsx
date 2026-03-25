'use client';

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import {
  Shield,
  Settings as SettingsIcon,
  Info,
  Save,
  Loader2,
  Zap,
  Bell,
  Lock,
  TrendingUp,
  MessageSquare,
  Users,
  UserPlus,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAppSettings } from '@/context/AppSettingsContext';
import SystemAuditTable from '@/components/SystemAuditTable';
import ExecutiveChat from '@/components/ExecutiveChat';
import type { AppSettings } from '@/lib/db/app-settings';

type TabId = 'trading' | 'risk' | 'neural' | 'notifications' | 'security' | 'chat' | 'subscribers';

const THEME_OPTIONS: { value: AppSettings['system']['theme']; label: string }[] = [
  { value: 'dark', label: 'כהה' },
  { value: 'light', label: 'בהיר' },
  { value: 'deep-sea', label: 'ים עמוק' },
];

const REFRESH_OPTIONS: { value: AppSettings['system']['dataRefreshIntervalMinutes']; label: string }[] = [
  { value: 1, label: 'דקה' },
  { value: 5, label: '5 דקות' },
  { value: 15, label: '15 דקות' },
];

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'trading', label: 'מסחר וביצוע', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'risk', label: 'ניהול סיכונים', icon: <Shield className="w-4 h-4" /> },
  { id: 'neural', label: 'בינה מלאכותית', icon: <Zap className="w-4 h-4" /> },
  { id: 'notifications', label: 'התראות מנכ"ל', icon: <Bell className="w-4 h-4" /> },
  { id: 'security', label: 'אבטחה ובקרה', icon: <Lock className="w-4 h-4" /> },
  { id: 'chat', label: 'צ\'אט מנהלים', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'subscribers', label: 'מנויים לבוט', icon: <Users className="w-4 h-4" /> },
];

/** Deep Sea cockpit: navy surfaces, cyan accent, RTL labels, LTR numbers */
const inputClass =
  'w-full px-3 py-2 rounded-lg bg-[#07192d] border border-cyan-900/50 text-cyan-50 focus:ring-2 focus:ring-cyan-400/50 focus:border-cyan-400/50';
const labelClass = 'flex items-center gap-1.5 text-sm font-medium text-cyan-100/90 mb-1';
const cardClass = 'rounded-xl border border-cyan-900/50 bg-[#07192d]/80 overflow-hidden';
const sectionClass = 'p-4 sm:p-5 border-b border-cyan-900/40 bg-[#07192d]/60 flex items-center gap-2';

type SubscriberRow = { id: number; chat_id: string; username: string | null; is_active: boolean; role: string; created_at: string | null };

function SubscribersPanel() {
  const { success, error } = useToast();
  const [list, setList] = useState<SubscriberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatIdInput, setChatIdInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadSubscribers = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await fetch('/api/settings/subscribers', { credentials: 'include', cache: 'no-store' });
      const data = r.ok ? await r.json() : { subscribers: [] };
      if (Array.isArray(data.subscribers)) setList(data.subscribers);
    } catch {
      if (!silent) setList([]);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscribers();
  }, [loadSubscribers]);

  async function handleAddSubscriber(e: FormEvent) {
    e.preventDefault();
    const chat_id = chatIdInput.trim();
    if (!chat_id) {
      error('נא להזין Chat ID');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/settings/subscribers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          username: usernameInput.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        error(typeof data.error === 'string' ? data.error : 'הוספת המנוי נכשלה');
        return;
      }
      success('המנוי נוסף בהצלחה');
      setChatIdInput('');
      setUsernameInput('');
      await loadSubscribers({ silent: true });
    } catch {
      error('שגיאת רשת — נסה שוב');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className={cardClass}>
        <div className={sectionClass}>
          <Users className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold text-cyan-100">מנויים לבוט טלגרם</h3>
        </div>
        <div className="p-4 sm:p-5">
          <div className="animate-pulse h-24 rounded-lg bg-cyan-900/20" />
        </div>
      </div>
    );
  }
  return (
    <div className={cardClass}>
      <div className={sectionClass}>
        <Users className="w-5 h-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-cyan-100">מנויים לבוט טלגרם</h3>
      </div>
      <div className="p-4 sm:p-5" dir="rtl">
        <p className="text-sm text-cyan-200/80 mb-4">
          משתמשים פעילים שמקבלים התראות בוט (עסקאות, סיכומים יומיים). אם הרשימה ריקה — ניתן להוסיף מנוי כאן או להשתמש ב־TELEGRAM_CHAT_ID מ־.env.
        </p>

        <form
          onSubmit={handleAddSubscriber}
          className="mb-6 rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-950/40 via-[#07192d]/70 to-emerald-950/30 p-4 sm:p-5 shadow-[0_0_40px_-12px_rgba(34,211,238,0.25)] backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 mb-4 text-cyan-100/95">
            <UserPlus className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">הוספת מנוי חדש</span>
            {refreshing && (
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400/80 mr-auto" aria-label="מרענן רשימה" />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            <div className="text-right">
              <label htmlFor="sub-chat-id" className={labelClass}>
                מזהה צ&apos;אט (Chat ID) <span className="text-emerald-400/90">*</span>
              </label>
              <input
                id="sub-chat-id"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="למשל 123456789"
                dir="ltr"
                className={`${inputClass} text-left font-mono placeholder:text-cyan-600/50`}
                value={chatIdInput}
                onChange={(ev) => setChatIdInput(ev.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="text-right">
              <label htmlFor="sub-username" className={labelClass}>
                שם משתמש בטלגרם <span className="text-cyan-500/70 text-xs font-normal">(אופציונלי)</span>
              </label>
              <input
                id="sub-username"
                type="text"
                autoComplete="off"
                placeholder="@username או ללא @"
                dir="ltr"
                className={`${inputClass} text-left font-mono placeholder:text-cyan-600/50`}
                value={usernameInput}
                onChange={(ev) => setUsernameInput(ev.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
          <div className="mt-5 flex justify-start sm:justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-2.5 text-sm font-bold text-[#021018] transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:opacity-50 disabled:pointer-events-none"
            >
              <span
                className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 opacity-100 transition-opacity group-hover:opacity-95"
                aria-hidden
              />
              <span
                className="absolute inset-0 opacity-60 blur-xl bg-gradient-to-r from-emerald-400 to-cyan-400 group-hover:opacity-90 transition-opacity"
                aria-hidden
              />
              <span className="relative flex items-center gap-2">
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <UserPlus className="w-4 h-4" aria-hidden />
                )}
                הוסף מנוי
              </span>
            </button>
          </div>
        </form>

        {list.length === 0 ? (
          <p className="text-sm text-cyan-500/90">אין מנויים בטבלה עדיין. השתמש בטופס למעלה או ב־TELEGRAM_CHAT_ID.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cyan-900/50">
            <table className="w-full text-sm text-right">
              <thead className="bg-cyan-900/30 text-cyan-200/90">
                <tr>
                  <th className="px-4 py-2 font-semibold">chat_id</th>
                  <th className="px-4 py-2 font-semibold">שם משתמש</th>
                  <th className="px-4 py-2 font-semibold">פעיל</th>
                  <th className="px-4 py-2 font-semibold">תפקיד</th>
                </tr>
              </thead>
              <tbody className="text-cyan-100/90 divide-y divide-cyan-900/30">
                {list.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                      {s.chat_id}
                    </td>
                    <td className="px-4 py-2">{s.username ?? '—'}</td>
                    <td className="px-4 py-2">{s.is_active ? 'כן' : 'לא'}</td>
                    <td className="px-4 py-2">{s.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsCommandCenter() {
  const toast = useToast();
  const { refreshSettings } = useAppSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('trading');
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(null);

  const form = useForm<AppSettings>({
    defaultValues: {} as AppSettings,
  });
  const { register, handleSubmit, reset, formState: { isDirty }, watch } = form;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/app', { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AppSettings | null) => {
        if (!cancelled && data) {
          setInitialSettings(data);
          reset(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reset]);

  const trySetTab = useCallback(
    (tab: TabId) => {
      if (isDirty) {
        const ok = window.confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?');
        if (!ok) return;
      }
      setActiveTab(tab);
    },
    [isDirty]
  );

  const onSubmit = async (formValues: AppSettings) => {
    setSaving(true);
    const rawNeural = { ...initialSettings!.neural, ...formValues.neural };
    const w = rawNeural.moeWeightsOverride;
    const hasWeights = w && [w.tech, w.risk, w.psych, w.macro].every((x) => typeof x === 'number' && Number.isFinite(x));
    const moeWeightsOverride = hasWeights && (w!.tech + w!.risk + w!.psych + w!.macro) > 0
      ? { tech: w!.tech / 100, risk: w!.risk / 100, psych: w!.psych / 100, macro: w!.macro / 100 }
      : undefined;
    const payload: AppSettings = {
      ...initialSettings,
      ...formValues,
      trading: { ...initialSettings!.trading, ...formValues.trading },
      risk: { ...initialSettings!.risk, ...formValues.risk },
      scanner: { ...initialSettings!.scanner, ...formValues.scanner },
      neural: { ...rawNeural, moeWeightsOverride },
      notifications: { ...initialSettings!.notifications, ...formValues.notifications },
      system: { ...initialSettings!.system, ...formValues.system },
    };
    try {
      const res = await fetch('/api/settings/app', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setInitialSettings(json.settings ?? payload);
        reset(json.settings ?? payload);
        await refreshSettings();
        toast.success('הגדרות עודכנו וסונכרנו מול המפקח העליון');
      } else {
        toast.error(json?.error ?? 'שגיאה בשמירת ההגדרות');
      }
    } catch {
      toast.error('שגיאת רשת');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !initialSettings) {
    return (
      <section
        className="mb-6 sm:mb-8 p-4 sm:p-6 rounded-2xl border border-cyan-900/50 bg-[#030f1c]/95"
        dir="rtl"
        aria-label="מרכז שליטה"
      >
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-cyan-900/30 rounded" />
          <div className="h-24 bg-cyan-900/20 rounded-xl" />
          <div className="h-24 bg-cyan-900/20 rounded-xl" />
        </div>
      </section>
    );
  }

  const settings = watch();

  return (
    <section
      className="mb-6 sm:mb-8 rounded-2xl border border-cyan-900/50 bg-[#030f1c]/95 overflow-hidden min-w-0 w-full"
      aria-label="מרכז שליטה — מרכז פקודות מאסטר"
      dir="rtl"
    >
      <div className="p-4 sm:p-6 border-b border-cyan-900/50 bg-[#07192d]/80 flex items-center gap-2 min-w-0">
        <SettingsIcon className="w-6 h-6 text-cyan-400 shrink-0" aria-hidden />
        <h2 className="text-xl font-bold text-cyan-50">מרכז פקודות מאסטר</h2>
      </div>

      {/* Sidebar layout: tabs left, content right */}
      <div className="flex flex-col sm:flex-row min-h-0">
        <div
          className="flex sm:flex-col flex-wrap sm:flex-nowrap border-b sm:border-b-0 sm:border-e border-cyan-900/50 bg-[#07192d]/60 gap-0 shrink-0 sm:w-56"
          role="tablist"
          aria-label="קטגוריות הגדרות"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => trySetTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors sm:border-e-2 sm:border-b-0 border-b-2 sm:rounded-none rounded-none ${
                activeTab === tab.id
                  ? 'border-cyan-400 text-cyan-100 bg-cyan-900/20'
                  : 'border-transparent text-cyan-200/70 hover:text-cyan-100 hover:bg-cyan-900/10'
              }`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex-1 min-w-0 p-4 sm:p-6 overflow-auto">
        {/* A. Trading & Execution */}
        <div
          id="panel-trading"
          role="tabpanel"
          aria-labelledby="tab-trading"
          hidden={activeTab !== 'trading'}
          className="space-y-4"
        >
          <div className={cardClass}>
            <div className={sectionClass}>
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-cyan-100">מסחר וביצוע</h3>
            </div>
            <div className="p-4 sm:p-5 grid gap-4">
              <div>
                <label className={labelClass}>
                  גודל עסקה ברירת מחדל ($)
                  <span className="inline-flex w-4 h-4 rounded-full bg-cyan-900/60 text-cyan-400/80 cursor-help items-center justify-center" title="סכום בדולרים לכל עסקה">
                    <Info className="w-3 h-3" />
                  </span>
                </label>
                <input type="number" min={10} max={1000000} step={10} dir="ltr" className={inputClass} {...register('trading.defaultTradeSizeUsd', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>
                  מקסימום פוזיציות פתוחות
                  <span className="inline-flex w-4 h-4 rounded-full bg-cyan-900/60 text-cyan-400/80 cursor-help items-center justify-center" title="מספר מקסימלי של פוזיציות פתוחות במקביל">
                    <Info className="w-3 h-3" />
                  </span>
                </label>
                <input type="number" min={1} max={100} dir="ltr" className={inputClass} {...register('trading.maxOpenPositions', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>
                  סובלנות החלקה מקסימלית (%)
                  <span className="inline-flex w-4 h-4 rounded-full bg-cyan-900/60 text-cyan-400/80 cursor-help items-center justify-center" title="אחוז החלקה מקסימלי בביצוע">
                    <Info className="w-3 h-3" />
                  </span>
                </label>
                <input type="number" min={0} max={10} step={0.1} dir="ltr" className={inputClass} {...register('trading.maxSlippagePct', { valueAsNumber: true })} />
              </div>
            </div>
          </div>
        </div>

        {/* B. Risk Sentinel */}
        <div
          id="panel-risk"
          role="tabpanel"
          aria-labelledby="tab-risk"
          hidden={activeTab !== 'risk'}
          className="space-y-4"
        >
          <div className={cardClass}>
            <div className={sectionClass}>
              <Shield className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-cyan-100">ניהול סיכונים</h3>
            </div>
            <div className="p-4 sm:p-5 grid gap-4">
              <div>
                <label className={labelClass}>חשיפה גלובלית מקסימלית (%)</label>
                <input type="number" min={0} max={100} step={1} dir="ltr" className={inputClass} {...register('risk.globalMaxExposurePct', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>מגבלת ריכוז נכס בודד (%)</label>
                <input type="number" min={0} max={100} step={1} dir="ltr" className={inputClass} {...register('risk.singleAssetConcentrationLimitPct', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>מכפיל ATR ליעד רווח (TP)</label>
                <input type="number" min={0.5} max={20} step={0.5} dir="ltr" className={inputClass} {...register('risk.atrMultiplierTp', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>מכפיל ATR לסטופ־לוס (SL)</label>
                <input type="number" min={0.5} max={20} step={0.5} dir="ltr" className={inputClass} {...register('risk.atrMultiplierSl', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>סטופ־לוס ברירת מחדל (%)</label>
                <input type="number" min={0.5} max={50} step={0.5} dir="ltr" className={inputClass} {...register('risk.defaultStopLossPct', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>יעד רווח ברירת מחדל (%)</label>
                <input type="number" min={1} max={100} step={0.5} dir="ltr" className={inputClass} {...register('risk.defaultTakeProfitPct', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>
                  גודל פוזיציה בסיסי ($)
                  <span className="inline-flex w-4 h-4 rounded-full bg-cyan-900/60 text-cyan-400/80 cursor-help items-center justify-center" title="משמש לחישוב גודל פוזיציה בפועל לפי מצב סיכון">
                    <Info className="w-3 h-3" />
                  </span>
                </label>
                <input type="number" min={10} max={1000000} step={10} dir="ltr" className={inputClass} {...register('risk.defaultPositionSizeUsd', { valueAsNumber: true })} />
              </div>
              {/* God-Mode: Risk Tolerance — R:R level */}
              <div>
                <label className={labelClass}>
                  מצב מסחר (Conservative / Aggressive)
                  <span className="inline-flex w-4 h-4 rounded-full bg-cyan-900/60 text-cyan-400/80 cursor-help items-center justify-center" title="Strict=Conservative, Moderate=Balanced, Aggressive=High risk/high size">
                    <Info className="w-3 h-3" />
                  </span>
                </label>
                <select dir="rtl" className={inputClass} {...register('risk.riskToleranceLevel')}>
                  <option value="strict">Conservative / סטריקט (1:3)</option>
                  <option value="moderate">Balanced / ממוצע (1:2)</option>
                  <option value="aggressive">Aggressive / אגרסיבי (1:1.5)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* C. Neural Engine */}
        <div
          id="panel-neural"
          role="tabpanel"
          aria-labelledby="tab-neural"
          hidden={activeTab !== 'neural'}
          className="space-y-4"
        >
          <div className={cardClass}>
            <div className={sectionClass}>
              <Zap className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-cyan-100">בינה מלאכותית</h3>
            </div>
            <div className="p-4 sm:p-5 grid gap-4">
              <div>
                <label className={labelClass}>
                  סף ביטחון MoE (ציון מינימלי לאישור עסקה)
                  <span className="inline-flex w-4 h-4 rounded-full bg-cyan-900/60 text-cyan-400/80 cursor-help items-center justify-center" title="ציון קונצנזוס מינימלי לאישור המלצה">
                    <Info className="w-3 h-3" />
                  </span>
                </label>
                <input type="number" min={50} max={95} dir="ltr" className={inputClass} {...register('neural.moeConfidenceThreshold', { valueAsNumber: true })} />
              </div>
              {/* God-Mode: MoE Weights override */}
              <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 space-y-2">
                <p className="text-sm font-medium text-cyan-100/90">משקלי MoE (אופציונלי — 0 = ברירת מחדל)</p>
                <p className="text-xs text-cyan-500/80">סכום מומלץ 100. לדוגמה: שבוע חדשות — העלאת מקרו.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-xs text-cyan-400/90">טכני %</label>
                    <input type="number" min={0} max={100} step={5} dir="ltr" className={inputClass} placeholder="30" {...register('neural.moeWeightsOverride.tech', { valueAsNumber: true })} />
                  </div>
                  <div>
                    <label className="text-xs text-cyan-400/90">סיכון %</label>
                    <input type="number" min={0} max={100} step={5} dir="ltr" className={inputClass} placeholder="30" {...register('neural.moeWeightsOverride.risk', { valueAsNumber: true })} />
                  </div>
                  <div>
                    <label className="text-xs text-cyan-400/90">פסיכ %</label>
                    <input type="number" min={0} max={100} step={5} dir="ltr" className={inputClass} placeholder="20" {...register('neural.moeWeightsOverride.psych', { valueAsNumber: true })} />
                  </div>
                  <div>
                    <label className="text-xs text-cyan-400/90">מקרו %</label>
                    <input type="number" min={0} max={100} step={5} dir="ltr" className={inputClass} placeholder="20" {...register('neural.moeWeightsOverride.macro', { valueAsNumber: true })} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">הפעלת RAG (זיכרון היסטורי)</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.neural?.ragEnabled}
                  onClick={() => form.setValue('neural.ragEnabled', !settings?.neural?.ragEnabled, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.neural?.ragEnabled ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.neural?.ragEnabled ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">פוסט־מורטם אוטומטי</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.neural?.autoPostMortemEnabled}
                  onClick={() => form.setValue('neural.autoPostMortemEnabled', !settings?.neural?.autoPostMortemEnabled, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.neural?.autoPostMortemEnabled ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.neural?.autoPostMortemEnabled ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div>
                <label className={labelClass}>סף ביטחון סורק AI (%)</label>
                <input type="number" min={50} max={95} dir="ltr" className={inputClass} {...register('scanner.aiConfidenceThreshold', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>נפח מינימלי 24 שעות (USD)</label>
                <input type="number" min={10000} max={10000000} step={10000} dir="ltr" className={inputClass} {...register('scanner.minVolume24hUsd', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={labelClass}>שינוי מחיר מינימלי לזיהוי ג&apos;ם (%)</label>
                <input type="number" min={0} max={50} step={0.5} dir="ltr" className={inputClass} {...register('scanner.minPriceChangePctForGem', { valueAsNumber: true })} />
              </div>
            </div>
          </div>
        </div>

        {/* D. Notifications */}
        <div
          id="panel-notifications"
          role="tabpanel"
          aria-labelledby="tab-notifications"
          hidden={activeTab !== 'notifications'}
          className="space-y-4"
        >
          <div className={cardClass}>
            <div className={sectionClass}>
              <Bell className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-cyan-100">התראות מנכ&quot;ל</h3>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">דוח פעימה יומי</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.notifications?.dailyPulseReport}
                  onClick={() => form.setValue('notifications.dailyPulseReport', !settings?.notifications?.dailyPulseReport, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.notifications?.dailyPulseReport ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.notifications?.dailyPulseReport ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">התראות סיכון קריטי</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.notifications?.riskCriticalAlerts}
                  onClick={() => form.setValue('notifications.riskCriticalAlerts', !settings?.notifications?.riskCriticalAlerts, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.notifications?.riskCriticalAlerts ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.notifications?.riskCriticalAlerts ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">ג&apos;ם עלית חדש זוהה</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.notifications?.newEliteGemDetected}
                  onClick={() => form.setValue('notifications.newEliteGemDetected', !settings?.notifications?.newEliteGemDetected, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.notifications?.newEliteGemDetected ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.notifications?.newEliteGemDetected ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">התראות טלגרם</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.system?.telegramNotifications}
                  onClick={() => form.setValue('system.telegramNotifications', !settings?.system?.telegramNotifications, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.system?.telegramNotifications ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.system?.telegramNotifications ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-cyan-100/90">התראות קול</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.system?.soundAlerts}
                  onClick={() => form.setValue('system.soundAlerts', !settings?.system?.soundAlerts, { shouldDirty: true })}
                  dir="ltr"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors ${
                    settings?.system?.soundAlerts ? 'border-cyan-400/60 bg-cyan-500/30' : 'border-cyan-900/60 bg-[#07192d]'
                  }`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow-sm transition-transform ${settings?.system?.soundAlerts ? 'translate-x-5 bg-cyan-400' : 'translate-x-0.5 bg-cyan-600/50'}`} />
                </button>
              </div>
              <div>
                <label className={labelClass}>ערכת נושא</label>
                <select dir="rtl" className={inputClass} {...register('system.theme')}>
                  {THEME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>מרווח רענון נתונים</label>
                <select dir="rtl" className={inputClass} {...register('system.dataRefreshIntervalMinutes', { valueAsNumber: true })}>
                  {REFRESH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* E. Security & Audit — read-only table */}
        <div
          id="panel-security"
          role="tabpanel"
          aria-labelledby="tab-security"
          hidden={activeTab !== 'security'}
          className="space-y-4"
        >
          <div className={cardClass}>
            <div className={sectionClass}>
              <Lock className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-cyan-100">אבטחה ובקרה</h3>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-sm text-cyan-200/80 mb-4">תצוגת רישום ביקורת מערכת — קריאה בלבד.</p>
              <SystemAuditTable />
            </div>
          </div>
        </div>

        {/* F. Executive Chat — Overseer terminal */}
        <div
          id="panel-chat"
          role="tabpanel"
          aria-labelledby="tab-chat"
          hidden={activeTab !== 'chat'}
          className="space-y-4"
        >
          <ExecutiveChat />
        </div>

        {/* G. Subscribers — active bot users (multi-tenant) */}
        <div
          id="panel-subscribers"
          role="tabpanel"
          aria-labelledby="tab-subscribers"
          hidden={activeTab !== 'subscribers'}
          className="space-y-4"
        >
          <SubscribersPanel />
        </div>

        {/* Save — only show when not on read-only Security, Chat or Subscribers tab, or when form is dirty */}
        {activeTab !== 'security' && activeTab !== 'chat' && activeTab !== 'subscribers' && (
          <div className="flex justify-end mt-6 pt-4 border-t border-cyan-900/40">
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:pointer-events-none text-white font-semibold text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  שומר…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" aria-hidden />
                  שמור שינויים
                </>
              )}
            </button>
          </div>
        )}
      </form>
      </div>
    </section>
  );
}
