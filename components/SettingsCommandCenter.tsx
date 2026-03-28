'use client';

import { useState, useEffect, useCallback, type FormEvent, type ReactNode } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
  Send,
  CheckCircle2,
  XCircle,
  Activity,
  Database,
  Cpu,
  ChevronDown,
  Radio,
  ScanLine,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAppSettings } from '@/context/AppSettingsContext';
import SystemAuditTable from '@/components/SystemAuditTable';
import ExecutiveChat from '@/components/ExecutiveChat';
import RiskCommandCenter from '@/components/RiskCommandCenter';
import type { AppSettings } from '@/lib/db/app-settings';
import SecureSecretInput from '@/components/SecureSecretInput';
import { getTelegramStatusAction, testTelegramAction } from '@/app/actions';
import { appSettingsFormSchema, type AppSettingsFormValues } from '@/lib/validation/app-settings-form';

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

const inputClass =
  'w-full rounded-xl border border-zinc-700/90 bg-black/40 px-4 py-2.5 text-sm text-zinc-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-500/50';
const selectClass = `${inputClass} appearance-none`;
const labelClass = 'flex items-center gap-1.5 text-sm font-medium text-emerald-100/90 mb-1';
const cardClass = 'rounded-xl border border-white/[0.06] bg-zinc-950/50 overflow-hidden';
const sectionClass = 'p-4 sm:p-5 border-b border-white/[0.06] bg-black/30 flex items-center gap-2';
const TOOLTIP_TOKEN =
  'מתקבל מ־@BotFather בטלגרם: /newbot → העתק את ה־API Token.';
const TOOLTIP_CHAT_ID =
  'מזהה הצ\'אט: שלח הודעה לבוט ואז פתח: https://api.telegram.org/bot<TOKEN>/getUpdates וחפש את "chat":{"id":...}';

function FieldErr({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-rose-400/95 mt-0.5 text-start">{msg}</p>;
}

function InstitutionalToggle({
  checked,
  onToggle,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 ${
        checked
          ? 'border-emerald-400/60 bg-emerald-950/50 shadow-[0_0_18px_rgba(16,185,129,0.45)]'
          : 'border-zinc-600 bg-zinc-950'
      }`}
    >
      <span
        className={`pointer-events-none absolute top-1 h-6 w-6 rounded-full shadow-md transition-all duration-300 ${
          checked
            ? 'end-1 start-auto bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]'
            : 'start-1 end-auto bg-zinc-600'
        }`}
      />
    </button>
  );
}

function ConnectionStatusBadge({ connected, children }: { connected: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums ${
        connected
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
          : 'border-zinc-600 bg-zinc-900/90 text-zinc-400'
      }`}
    >
      {connected && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
      )}
      {children}
    </span>
  );
}

function CommandTile({
  title,
  subtitle,
  icon,
  children,
  highlight,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: React.ReactNode;
  highlight?: 'gold' | 'emerald' | 'none';
}) {
  const ring =
    highlight === 'gold'
      ? 'border-amber-500/35 shadow-[0_0_32px_-8px_rgba(245,158,11,0.25)]'
      : highlight === 'emerald'
        ? 'border-emerald-500/30 shadow-[0_0_28px_-10px_rgba(16,185,129,0.2)]'
        : 'border-white/[0.08]';
  return (
    <div
      className={`relative rounded-2xl ${ring} bg-zinc-950/65 backdrop-blur-xl overflow-hidden`}
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}
    >
      <div
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent"
        aria-hidden
      />
      <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-start gap-3 bg-black/25">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-950/30 text-emerald-400">
          {icon}
        </div>
        <div className="min-w-0 flex-1 text-end">
          <h3 className="text-base font-bold text-zinc-50 tracking-tight">{title}</h3>
          {subtitle ? <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{subtitle}</p> : null}
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

type AuditLogRow = {
  id: number;
  timestamp: string;
  action_type: string;
  payload_diff: Record<string, unknown> | null;
};

function summarizePatch(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  const role = typeof p.actorRole === 'string' ? p.actorRole : '';
  const patch = (p.patch ?? p) as Record<string, unknown>;
  if (!patch || typeof patch !== 'object') return role ? `מפעיל: ${role}` : '';
  const keys = Object.keys(patch).filter((k) => k !== 'updated' && k !== 'actorRole');
  const tops = keys.slice(0, 5).join(', ');
  const parts = [role && `תפקיד ${role}`, tops && `ענפים: ${tops}`].filter(Boolean);
  return parts.join(' · ');
}

function RecentChangesPanel({ refreshKey }: { refreshKey: number }) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/settings/audit-logs?action_type=settings_update&limit=8', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : { logs: [] }))
      .then((d) => {
        if (!cancelled && Array.isArray(d.logs)) setLogs(d.logs);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/35 backdrop-blur-md p-4 mb-6">
      <div className="flex items-center gap-2 text-emerald-200/90 mb-3">
        <Radio className="w-4 h-4 text-amber-400/90 shrink-0" aria-hidden />
        <span className="text-sm font-semibold">שינויים אחרונים (ביקורת)</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          טוען…
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-zinc-500">אין רשומות עדיין.</p>
      ) : (
        <ul className="space-y-2 max-h-40 overflow-y-auto text-end">
          {logs.map((log) => (
            <li
              key={log.id}
              className="text-xs text-zinc-300 border border-white/[0.05] rounded-lg px-3 py-2 bg-zinc-950/50"
            >
              <span className="text-zinc-500 block mb-0.5">
                {new Date(log.timestamp).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
              <span className="text-zinc-200">{summarizePatch(log.payload_diff)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SubscriberRow = {
  id: number;
  chat_id: string;
  username: string | null;
  is_active: boolean;
  role: string;
  created_at: string | null;
};

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
          <Users className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-emerald-100">מנויים לבוט טלגרם</h3>
        </div>
        <div className="p-4 sm:p-5">
          <div className="animate-pulse h-24 rounded-lg bg-emerald-950/20" />
        </div>
      </div>
    );
  }
  return (
    <div className={cardClass}>
      <div className={sectionClass}>
        <Users className="w-5 h-5 text-emerald-400" />
        <h3 className="text-lg font-semibold text-emerald-100">מנויים לבוט טלגרם</h3>
      </div>
      <div className="p-4 sm:p-5" dir="rtl">
        <p className="text-sm text-zinc-400 mb-4">
          משתמשים פעילים שמקבלים התראות בוט. אם הרשימה ריקה — הוסף מנוי כאן.
        </p>
        <form
          onSubmit={handleAddSubscriber}
          className="mb-6 rounded-xl border border-white/[0.08] bg-black/30 p-4 sm:p-5"
        >
          <div className="flex items-center gap-2 mb-4 text-emerald-100/95">
            <UserPlus className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden />
            <span className="text-sm font-semibold">הוספת מנוי חדש</span>
            {refreshing && <Loader2 className="w-4 h-4 animate-spin text-emerald-400/80 ms-auto" aria-label="מרענן" />}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            <div className="text-end">
              <label htmlFor="sub-chat-id" className={labelClass}>
                מזהה צ&apos;אט <span className="text-emerald-400/90">*</span>
              </label>
              <SecureSecretInput
                id="sub-chat-id"
                placeholder="למשל 123456789"
                dir="ltr"
                inputMode="numeric"
                className="text-start"
                inputClassName={inputClass + ' pe-11 font-mono'}
                value={chatIdInput}
                onChange={setChatIdInput}
                disabled={submitting}
              />
            </div>
            <div className="text-end">
              <label htmlFor="sub-username" className={labelClass}>
                שם משתמש <span className="text-zinc-500 text-xs font-normal">(אופציונלי)</span>
              </label>
              <SecureSecretInput
                id="sub-username"
                placeholder="@username"
                dir="ltr"
                className="text-start"
                inputClassName={inputClass + ' pe-11'}
                value={usernameInput}
                onChange={setUsernameInput}
                disabled={submitting}
              />
            </div>
          </div>
          <div className="mt-5 flex justify-start sm:justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              הוסף מנוי
            </button>
          </div>
        </form>
        {list.length === 0 ? (
          <p className="text-sm text-zinc-500">אין מנויים בטבלה.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="w-full text-sm text-end">
              <thead className="bg-black/40 text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">chat_id</th>
                  <th className="px-4 py-2 font-semibold">שם משתמש</th>
                  <th className="px-4 py-2 font-semibold">פעיל</th>
                  <th className="px-4 py-2 font-semibold">תפקיד</th>
                </tr>
              </thead>
              <tbody className="text-zinc-200 divide-y divide-white/[0.05]">
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

type DiagnosticsState = Record<string, unknown> | null;

export default function SettingsCommandCenter() {
  const toast = useToast();
  const { refreshSettings } = useAppSettings();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(null);
  const [updatedAtIso, setUpdatedAtIso] = useState<string | null>(null);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [telegramConnected, setTelegramConnected] = useState<boolean | null>(null);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const form = useForm<AppSettingsFormValues>({
    resolver: zodResolver(appSettingsFormSchema),
    defaultValues: undefined,
    mode: 'onSubmit',
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const r = await fetch('/api/settings/app?includeMeta=1', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) {
        setLoadError('טעינת ההגדרות נכשלה — בדוק התחברות מנהל.');
        setInitialSettings(null);
        return;
      }
      const json = (await r.json()) as AppSettings | { settings: AppSettings; meta?: { updatedAt: string | null } };
      const data = 'settings' in json ? json.settings : (json as AppSettings);
      const meta = 'meta' in json ? json.meta : undefined;
      setUpdatedAtIso(meta?.updatedAt ?? null);
      setInitialSettings(data);
      reset(data as AppSettingsFormValues);
    } catch {
      setLoadError('שגיאת רשת — לא ניתן לטעון הגדרות.');
      setInitialSettings(null);
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    fetch('/api/ops/diagnostics', { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDiagnostics(d))
      .catch(() => setDiagnostics(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out = await getTelegramStatusAction();
      if (cancelled) return;
      if (!out.success) {
        setTelegramConnected(false);
        return;
      }
      setTelegramConnected(Boolean((out.data as { connected?: boolean } | null)?.connected));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ex = watch('execution');
  const masterOn = Boolean(ex?.masterSwitchEnabled);
  const modePaper = ex?.mode !== 'LIVE';
  const liveKeysReady = Boolean(initialSettings?.execution.liveApiKeyConfigured);
  const liveOk = Boolean(liveKeysReady && ex?.goLiveSafetyAcknowledged);

  const onSubmit = async (formValues: AppSettingsFormValues) => {
    if (!initialSettings) return;
    let mode = formValues.execution.mode;
    if (mode === 'LIVE' && !liveOk) {
      toast.error('LIVE זמין רק עם מפתחות בורסה מאומתים ואישור בטיחות.');
      setValue('execution.mode', 'PAPER');
      mode = 'PAPER';
    }
    const rawNeural = { ...initialSettings.neural, ...formValues.neural };
    const w = rawNeural.moeWeightsOverride;
    const hasWeights =
      w && [w.tech, w.risk, w.psych, w.macro].every((x) => typeof x === 'number' && Number.isFinite(x));
    const moeWeightsOverride =
      hasWeights && (w!.tech + w!.risk + w!.psych + w!.macro) > 0
        ? { tech: w!.tech / 100, risk: w!.risk / 100, psych: w!.psych / 100, macro: w!.macro / 100 }
        : undefined;
    const payload: AppSettings = {
      ...initialSettings,
      ...formValues,
      trading: { ...initialSettings.trading, ...formValues.trading },
      risk: { ...initialSettings.risk, ...formValues.risk },
      scanner: { ...initialSettings.scanner, ...formValues.scanner },
      neural: { ...rawNeural, moeWeightsOverride },
      notifications: { ...initialSettings.notifications, ...formValues.notifications },
      system: { ...initialSettings.system, ...formValues.system },
      execution: {
        ...initialSettings.execution,
        ...formValues.execution,
        mode,
        liveApiKeyConfigured: initialSettings.execution.liveApiKeyConfigured,
      },
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
        const next = (json.settings ?? payload) as AppSettings;
        setInitialSettings(next);
        reset(next as AppSettingsFormValues);
        await refreshSettings();
        setAuditRefreshKey((k) => k + 1);
        const metaR = await fetch('/api/settings/app?includeMeta=1', { credentials: 'include', cache: 'no-store' });
        if (metaR.ok) {
          const j = await metaR.json().catch(() => null);
          if (j && typeof j === 'object' && 'meta' in j) {
            const m = (j as { meta?: { updatedAt?: string | null } }).meta;
            setUpdatedAtIso(m?.updatedAt ?? null);
          }
        }
        toast.success('ההגדרות נשמרו במסד הנתונים וסונכרנו במערכת.');
      } else {
        toast.error(typeof json?.error === 'string' ? json.error : 'שגיאה בשמירת ההגדרות');
      }
    } catch {
      toast.error('שגיאת רשת');
    }
  };

  const handleTelegramTest = async (
    variant: 'connection' | 'system' | 'trade' | 'integration' = 'integration'
  ) => {
    setTelegramTesting(true);
    setTelegramTestResult(null);
    try {
      const sys = watch('system');
      const out = await testTelegramAction({
        variant,
        token: sys?.telegramBotToken ?? '',
        chatId: sys?.telegramChatId ?? '',
      });
      if (out.success) setTelegramTestResult(out.data as { ok: boolean; error?: string });
      else setTelegramTestResult({ ok: false, error: out.error });
    } catch {
      setTelegramTestResult({ ok: false, error: 'שגיאת רשת' });
    } finally {
      setTelegramTesting(false);
    }
  };

  const runScanNow = async () => {
    setScanRunning(true);
    try {
      const r = await fetch('/api/settings/scanner/run-cycle', {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok && j.status === 'disabled') {
        toast.error(typeof j.message === 'string' ? j.message : 'הסורק כבוי');
      } else if (r.ok && j.ok) {
        toast.success(typeof j.message === 'string' ? j.message : 'סריקה הושלמה');
      } else {
        toast.error(typeof j.error === 'string' ? j.error : 'הרצת הסריקה נכשלה');
      }
    } catch {
      toast.error('שגיאת רשת');
    } finally {
      setScanRunning(false);
    }
  };

  if (loading) {
    return (
      <section
        className="mb-6 sm:mb-8 p-4 sm:p-6 rounded-2xl border border-emerald-500/20 bg-black/50 backdrop-blur-xl"
        dir="rtl"
        aria-label="מרכז שליטה"
      >
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-emerald-950/40 rounded" />
          <div className="h-24 bg-zinc-900/80 rounded-xl" />
        </div>
      </section>
    );
  }

  if (loadError || !initialSettings) {
    return (
      <section
        className="mb-6 sm:mb-8 p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20 backdrop-blur-xl text-center"
        dir="rtl"
      >
        <p className="text-rose-200 mb-4">{loadError ?? 'לא ניתן לטעון את מרכז ההגדרות.'}</p>
        <button
          type="button"
          onClick={() => void loadSettings()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500"
        >
          נסה שוב
        </button>
      </section>
    );
  }

  const settings = watch();
  const pgOk = diagnostics && (diagnostics as { dbHealth?: { status?: string } }).dbHealth?.status === 'online';
  const pineOk =
    diagnostics &&
    (diagnostics as { vectorStorageHealth?: { status?: string } }).vectorStorageHealth?.status === 'online';

  return (
    <section
      className="mb-6 sm:mb-8 rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-zinc-950/95 via-black/80 to-black/95 backdrop-blur-2xl overflow-hidden shadow-[0_0_60px_-20px_rgba(16,185,129,0.35)]"
      aria-label="מרכז פקודות — Mon Cheri"
      dir="rtl"
    >
      <div className="p-4 sm:p-6 border-b border-white/[0.06] flex flex-wrap items-center gap-3 bg-black/40">
        <SettingsIcon className="w-7 h-7 text-emerald-400 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 text-end">
          <h2 className="text-xl font-bold text-zinc-50 tracking-tight">מרכז פקודות — Mon Cheri</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            עדכון אחרון בשרת:{' '}
            {updatedAtIso
              ? new Date(updatedAtIso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
              : '—'}
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {masterOn && (
          <div
            className={`mb-6 rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 ${
              modePaper
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100'
                : 'border-amber-500/50 bg-amber-950/25 text-amber-100'
            }`}
            role="status"
          >
            <Zap className={`w-5 h-5 shrink-0 ${modePaper ? 'text-emerald-400' : 'text-amber-400'}`} />
            <div className="text-sm font-semibold text-end flex-1">
              {modePaper
                ? 'מערכת פעילה — מצב הדגמה (Paper). ביצוע אוטונומי ללא חיבור חי לבורסה.'
                : 'מערכת חמושה — מצב LIVE. ודא בקרות סיכון לפני המשך.'}
            </div>
          </div>
        )}

        {!masterOn && (
          <div
            className="mb-6 rounded-xl border border-zinc-600/50 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-400 flex items-center gap-2"
            role="status"
          >
            <Lock className="w-5 h-5 text-zinc-500 shrink-0" />
            <span>מתג ראשי כבוי — הביצוע האוטונומי מושבת.</span>
          </div>
        )}

        <RecentChangesPanel refreshKey={auditRefreshKey} />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
            <CommandTile
              title="מנוע מסחר"
              subtitle="מתג מאסטר, Paper/Live, סף ביטחון לביצוע, פרמטרי סיכון."
              icon={<TrendingUp className="w-5 h-5" />}
              highlight={!modePaper && masterOn ? 'gold' : masterOn ? 'emerald' : 'none'}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-zinc-200">מתג ראשי (מאסטר)</span>
                  <Controller
                    name="execution.masterSwitchEnabled"
                    control={control}
                    render={({ field }) => (
                      <InstitutionalToggle
                        checked={Boolean(field.value)}
                        onToggle={() => field.onChange(!field.value)}
                        aria-label="מתג ראשי"
                      />
                    )}
                  />
                </div>
                <Controller
                  name="execution.mode"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => field.onChange('PAPER')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                          field.value === 'PAPER'
                            ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                            : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
                        }`}
                      >
                        Paper
                      </button>
                      <button
                        type="button"
                        disabled={!liveOk}
                        title={
                          !liveOk ? 'נדרשים מפתחות LIVE ואישור בטיחות במערכת' : 'מעבר ל-LIVE'
                        }
                        onClick={() => liveOk && field.onChange('LIVE')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                          field.value === 'LIVE'
                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-100'
                            : 'border-zinc-600 text-zinc-400 hover:border-zinc-500'
                        }`}
                      >
                        LIVE
                      </button>
                    </div>
                  )}
                />
                <label className={labelClass}>סף ביטחון מינימלי לביצוע (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  dir="ltr"
                  className={inputClass}
                  {...register('execution.minConfidenceToExecute', { valueAsNumber: true })}
                />
                <FieldErr msg={errors.execution?.minConfidenceToExecute?.message} />
                <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] p-3 bg-black/25">
                  <input
                    type="checkbox"
                    id="go-live-ack"
                    className="mt-1 rounded border-zinc-600"
                    {...register('execution.goLiveSafetyAcknowledged')}
                  />
                  <label htmlFor="go-live-ack" className="text-sm text-zinc-300 leading-relaxed cursor-pointer">
                    אישרתי את רשימת הבטיחות (החלקה, גודל פוזיציה, סטופ) לפני אפשרות LIVE.
                  </label>
                </div>
                <ConnectionStatusBadge connected={liveKeysReady}>
                  {liveKeysReady ? 'מפתחות בורסה: מוגדרים' : 'מפתחות בורסה: לא מוגדרים (סביבה)'}
                </ConnectionStatusBadge>
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <RiskCommandCenter />
                </div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider">פרמטרי סיכון</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>חשיפה גלובלית מקסימלית (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.globalMaxExposurePct', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.globalMaxExposurePct?.message} />
                  </div>
                  <div>
                    <label className={labelClass}>ריכוז נכס בודד (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.singleAssetConcentrationLimitPct', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.singleAssetConcentrationLimitPct?.message} />
                  </div>
                  <div>
                    <label className={labelClass}>מכפיל ATR ליעד רווח</label>
                    <input
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.5}
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.atrMultiplierTp', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.atrMultiplierTp?.message} />
                  </div>
                  <div>
                    <label className={labelClass}>מכפיל ATR לסטופ</label>
                    <input
                      type="number"
                      min={0.5}
                      max={20}
                      step={0.5}
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.atrMultiplierSl', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.atrMultiplierSl?.message} />
                  </div>
                  <div>
                    <label className={labelClass}>סטופ ברירת מחדל (%)</label>
                    <input
                      type="number"
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.defaultStopLossPct', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.defaultStopLossPct?.message} />
                  </div>
                  <div>
                    <label className={labelClass}>יעד רווח ברירת מחדל (%)</label>
                    <input
                      type="number"
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.defaultTakeProfitPct', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.defaultTakeProfitPct?.message} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>גודל פוזיציה בסיסי ($)</label>
                    <input
                      type="number"
                      min={10}
                      dir="ltr"
                      className={inputClass}
                      {...register('risk.defaultPositionSizeUsd', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.risk?.defaultPositionSizeUsd?.message} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>מצב סיכון</label>
                    <select dir="rtl" className={selectClass} {...register('risk.riskToleranceLevel')}>
                      <option value="strict">שמרני (1:3)</option>
                      <option value="moderate">מאוזן (1:2)</option>
                      <option value="aggressive">אגרסיבי (1:1.5)</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider">מסחר</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>גודל עסקה ברירת מחדל ($)</label>
                    <input
                      type="number"
                      min={10}
                      dir="ltr"
                      className={inputClass}
                      {...register('trading.defaultTradeSizeUsd', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.trading?.defaultTradeSizeUsd?.message} />
                  </div>
                  <div>
                    <label className={labelClass}>מקסימום פוזיציות</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      dir="ltr"
                      className={inputClass}
                      {...register('trading.maxOpenPositions', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.trading?.maxOpenPositions?.message} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>סובלנות החלקה מקסימלית (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      dir="ltr"
                      className={inputClass}
                      {...register('trading.maxSlippagePct', { valueAsNumber: true })}
                    />
                    <FieldErr msg={errors.trading?.maxSlippagePct?.message} />
                  </div>
                </div>
              </div>
            </CommandTile>

            <CommandTile
              title="בינה ומודלים"
              subtitle="טמפרטורת LLM, סף MoE, סורק, RAG."
              icon={<Cpu className="w-5 h-5" />}
              highlight="emerald"
            >
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-zinc-600 px-2 py-1 text-zinc-400">
                    מודל ראשי: סביבה (GEMINI/GROQ)
                  </span>
                </div>
                <div>
                  <label className={labelClass}>
                    טמפרטורת LLM (0–2)
                    <span className="inline-flex w-4 h-4 rounded-full bg-zinc-700 items-center justify-center ms-1" title="משפיעה על יצירתיות המודל בניתוח ובקונצנזוס">
                      <Info className="w-3 h-3" />
                    </span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    dir="ltr"
                    className={inputClass}
                    {...register('neural.llmTemperature', { valueAsNumber: true })}
                  />
                  <FieldErr msg={errors.neural?.llmTemperature?.message} />
                </div>
                <div>
                  <label className={labelClass}>סף ביטחון MoE (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={95}
                    dir="ltr"
                    className={inputClass}
                    {...register('neural.moeConfidenceThreshold', { valueAsNumber: true })}
                  />
                  <FieldErr msg={errors.neural?.moeConfidenceThreshold?.message} />
                </div>
                <div className="rounded-lg border border-white/[0.06] p-3 space-y-2 bg-black/20">
                  <p className="text-sm font-medium text-zinc-200">משקלי MoE (אופציונלי — סכום 100)</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="טכני"
                      dir="ltr"
                      className={inputClass}
                      {...register('neural.moeWeightsOverride.tech', { valueAsNumber: true })}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="סיכון"
                      dir="ltr"
                      className={inputClass}
                      {...register('neural.moeWeightsOverride.risk', { valueAsNumber: true })}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="פסיכ"
                      dir="ltr"
                      className={inputClass}
                      {...register('neural.moeWeightsOverride.psych', { valueAsNumber: true })}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="מקרו"
                      dir="ltr"
                      className={inputClass}
                      {...register('neural.moeWeightsOverride.macro', { valueAsNumber: true })}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-zinc-200">RAG (זיכרון היסטורי)</span>
                  <InstitutionalToggle
                    checked={Boolean(settings?.neural?.ragEnabled)}
                    onToggle={() => setValue('neural.ragEnabled', !settings?.neural?.ragEnabled, { shouldDirty: true })}
                    aria-label="RAG"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-zinc-200">פוסט־מורטם אוטומטי</span>
                  <InstitutionalToggle
                    checked={Boolean(settings?.neural?.autoPostMortemEnabled)}
                    onToggle={() =>
                      setValue('neural.autoPostMortemEnabled', !settings?.neural?.autoPostMortemEnabled, {
                        shouldDirty: true,
                      })
                    }
                    aria-label="פוסט מורטם"
                  />
                </div>
                <div>
                  <label className={labelClass}>סף ביטחון סורק AI (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={95}
                    dir="ltr"
                    className={inputClass}
                    {...register('scanner.aiConfidenceThreshold', { valueAsNumber: true })}
                  />
                  <FieldErr msg={errors.scanner?.aiConfidenceThreshold?.message} />
                </div>
                <div>
                  <label className={labelClass}>נפח מינימלי 24ש׳ (USD)</label>
                  <input
                    type="number"
                    min={10000}
                    step={10000}
                    dir="ltr"
                    className={inputClass}
                    {...register('scanner.minVolume24hUsd', { valueAsNumber: true })}
                  />
                  <FieldErr msg={errors.scanner?.minVolume24hUsd?.message} />
                </div>
                <div>
                  <label className={labelClass}>שינוי מחיר מינימלי לג&apos;ם (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    dir="ltr"
                    className={inputClass}
                    {...register('scanner.minPriceChangePctForGem', { valueAsNumber: true })}
                  />
                  <FieldErr msg={errors.scanner?.minPriceChangePctForGem?.message} />
                </div>
              </div>
            </CommandTile>

            <CommandTile
              title="בוטים — טלגרם"
              subtitle="התראות, טוקן, בדיקה, מנויים."
              icon={<MessageSquare className="w-5 h-5" />}
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-zinc-300">סטטוס Webhook / שירות</span>
                  {telegramConnected !== null && (
                    <ConnectionStatusBadge connected={telegramConnected}>
                      {telegramConnected ? 'מחובר' : 'לא זמין'}
                    </ConnectionStatusBadge>
                  )}
                </div>
                <div className={cardClass}>
                  <div className={sectionClass}>
                    <Bell className="w-5 h-5 text-amber-400/90" />
                    <h3 className="text-sm font-semibold text-zinc-200">התראות מנכ&quot;ל</h3>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-zinc-300">דוח פעימה יומי</span>
                      <InstitutionalToggle
                        checked={Boolean(settings?.notifications?.dailyPulseReport)}
                        onToggle={() =>
                          setValue('notifications.dailyPulseReport', !settings?.notifications?.dailyPulseReport, {
                            shouldDirty: true,
                          })
                        }
                        aria-label="דוח פעימה יומי"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-zinc-300">התראות סיכון קריטי</span>
                      <InstitutionalToggle
                        checked={Boolean(settings?.notifications?.riskCriticalAlerts)}
                        onToggle={() =>
                          setValue(
                            'notifications.riskCriticalAlerts',
                            !settings?.notifications?.riskCriticalAlerts,
                            { shouldDirty: true }
                          )
                        }
                        aria-label="התראות סיכון קריטי"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-zinc-300">ג&apos;ם עלית חדש</span>
                      <InstitutionalToggle
                        checked={Boolean(settings?.notifications?.newEliteGemDetected)}
                        onToggle={() =>
                          setValue(
                            'notifications.newEliteGemDetected',
                            !settings?.notifications?.newEliteGemDetected,
                            { shouldDirty: true }
                          )
                        }
                        aria-label="ג'ם עלית חדש"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-zinc-300">התראות טלגרם</span>
                  <InstitutionalToggle
                    checked={Boolean(settings?.system?.telegramNotifications)}
                    onToggle={() =>
                      setValue('system.telegramNotifications', !settings?.system?.telegramNotifications, {
                        shouldDirty: true,
                      })
                    }
                    aria-label="התראות טלגרם"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="telegram-token" className={labelClass}>
                      טוקן בוט
                      <span className="ms-1 cursor-help" title={TOOLTIP_TOKEN}>
                        <Info className="w-3 h-3 inline" />
                      </span>
                    </label>
                    <Controller
                      name="system.telegramBotToken"
                      control={control}
                      render={({ field }) => (
                        <SecureSecretInput
                          id="telegram-token"
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          placeholder="••••••••"
                          dir="ltr"
                          inputClassName={inputClass}
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label htmlFor="telegram-chat-id" className={labelClass}>
                      מזהה צ&apos;אט
                      <span className="ms-1 cursor-help" title={TOOLTIP_CHAT_ID}>
                        <Info className="w-3 h-3 inline" />
                      </span>
                    </label>
                    <Controller
                      name="system.telegramChatId"
                      control={control}
                      render={({ field }) => (
                        <SecureSecretInput
                          id="telegram-chat-id"
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          placeholder="123456789"
                          dir="ltr"
                          inputMode="numeric"
                          inputClassName={inputClass}
                        />
                      )}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTelegramTest('integration')}
                    disabled={telegramTesting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium"
                  >
                    {telegramTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    בדיקת חיבור
                  </button>
                </div>
                {telegramTestResult && (
                  <div
                    className={`flex items-center gap-2 text-sm ${telegramTestResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {telegramTestResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {telegramTestResult.ok ? 'נשלח בהצלחה.' : telegramTestResult.error || 'נכשל'}
                  </div>
                )}
                <SubscribersPanel />
              </div>
            </CommandTile>

            <CommandTile
              title="תשתית מערכת"
              subtitle="בריאות DB, וקטור, הרצת סריקה, העדפות ממשק."
              icon={<Database className="w-5 h-5" />}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 bg-black/25">
                    <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-zinc-300">Postgres</span>
                    <ConnectionStatusBadge connected={Boolean(pgOk)}>{pgOk ? 'מקוון' : 'בעיה'}</ConnectionStatusBadge>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 bg-black/25">
                    <Activity className="w-4 h-4 text-amber-400/90 shrink-0" />
                    <span className="text-zinc-300">Pinecone</span>
                    <ConnectionStatusBadge connected={Boolean(pineOk)}>{pineOk ? 'מסונכרן' : 'לא פעיל'}</ConnectionStatusBadge>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2 bg-black/25 sm:col-span-2">
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-zinc-300">זרקת זיכרון (RAG)</span>
                    <span className={settings?.neural?.ragEnabled ? 'text-emerald-300' : 'text-zinc-500'}>
                      {settings?.neural?.ragEnabled ? 'פעיל' : 'כבוי'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void runScanNow()}
                  disabled={scanRunning}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-100 text-sm font-semibold hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {scanRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                  הרץ סריקה עכשיו
                </button>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  מריץ מחזור סריקה אחד (כמו Cron). לא נקשר לשמירת הגדרות. אם הסורק כבוי בלוח הבקרה — הפעל אותו תחילה.
                </p>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-zinc-300">התראות קול</span>
                  <InstitutionalToggle
                    checked={Boolean(settings?.system?.soundAlerts)}
                    onToggle={() => setValue('system.soundAlerts', !settings?.system?.soundAlerts, { shouldDirty: true })}
                    aria-label="קול"
                  />
                </div>
                <div>
                  <label className={labelClass}>ערכת נושא</label>
                  <select dir="rtl" className={selectClass} {...register('system.theme')}>
                    {THEME_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <FieldErr msg={errors.system?.theme?.message} />
                </div>
                <div>
                  <label className={labelClass}>מרווח רענון נתונים</label>
                  <select
                    dir="rtl"
                    className={selectClass}
                    {...register('system.dataRefreshIntervalMinutes', { valueAsNumber: true })}
                  >
                    {REFRESH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <FieldErr msg={errors.system?.dataRefreshIntervalMinutes?.message} />
                </div>
                <button
                  type="button"
                  onClick={() => setShowAudit((s) => !s)}
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-white/[0.08] text-sm text-zinc-300 hover:bg-white/[0.04]"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAudit ? 'rotate-180' : ''}`} />
                  ביקורת מערכת מלאה
                </button>
                {showAudit && (
                  <div className="rounded-xl border border-white/[0.08] p-3 bg-black/30 max-h-96 overflow-auto">
                    <SystemAuditTable />
                  </div>
                )}
              </div>
            </CommandTile>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-black/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowChat((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-200 hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                צ&apos;אט מנהלים
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showChat ? 'rotate-180' : ''}`} />
            </button>
            {showChat && (
              <div className="p-4 border-t border-white/[0.06]">
                <ExecutiveChat />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4 border-t border-white/[0.06]">
            <button
              type="submit"
              disabled={isSubmitting || !isDirty}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 disabled:pointer-events-none text-white font-bold text-sm shadow-[0_0_24px_rgba(16,185,129,0.35)]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  שומר…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  שמור שינויים
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
