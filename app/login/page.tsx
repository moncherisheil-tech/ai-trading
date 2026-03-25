'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Lock, Loader2, ShieldCheck } from 'lucide-react';
import { loginWithPassword } from '@/app/actions';
import LanguageToggle from '@/components/LanguageToggle';
import { useLocale } from '@/hooks/use-locale';

function sanitizeRedirectTarget(from: string | null): string {
  if (!from) return '/';
  if (from === '/') return '/';
  if (from === '/ops' || from.startsWith('/ops/')) return from;
  return '/';
}

function LoginForm() {
  const { locale, isRtl } = useLocale();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await loginWithPassword(password);
      if (result.success) {
        const target = sanitizeRedirectTarget(searchParams.get('from')) || result.redirectTo || '/';
        window.location.href = target;
        return;
      }
      setError(result.error);
    } catch {
      setError(locale === 'he' ? 'אירעה שגיאה. נסה שוב.' : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-zinc-900/60 p-8 shadow-2xl frosted-obsidian sm:p-10" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="pointer-events-none absolute -top-20 -start-20 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -end-20 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />

      <div className="relative">
        <div className="mb-8 flex items-center justify-between border-b border-white/5 pb-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-2.5 shadow-[0_0_25px_rgba(34,211,238,0.2)]">
              <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">{locale === 'he' ? 'גישת הנהלה' : 'Institution Access'}</p>
              <h1 className="text-lg font-semibold text-zinc-100">{locale === 'he' ? 'אימות כניסה למערכת' : 'Terminal Authentication'}</h1>
            </div>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-emerald-300">
            {locale === 'he' ? 'מאובטח' : 'Secure'}
          </span>
        </div>

        <p className="mb-7 text-sm text-zinc-400">
          {locale === 'he'
            ? 'גישה למורשים בלבד. אסימוני סשן מאומתים בכל בקשה מוגנת.'
            : 'Authorized personnel only. Session tokens are validated on every protected request.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
              {locale === 'he' ? 'מפתח גישה' : 'Access Key'}
            </label>
            <div className="group relative">
              <Lock className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors duration-200 group-focus-within:text-cyan-300" />
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={locale === 'he' ? 'הזן מפתח מאובטח' : 'Enter secure key'}
                className="h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/80 ps-11 pe-4 text-zinc-100 placeholder:text-zinc-500 outline-none transition-all duration-200 focus:border-cyan-400/45 focus:ring-2 focus:ring-cyan-400/30 focus-visible:ring-2 focus-visible:ring-cyan-400/35"
                required
                disabled={loading}
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            aria-label={locale === 'he' ? 'כניסה מאובטחת למערכת' : 'Secure terminal login'}
            className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:border-cyan-400/45 hover:bg-cyan-400/10 hover:text-cyan-200 hover:shadow-[0_0_24px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {locale === 'he' ? 'מאמת' : 'Verifying'}
              </>
            ) : (
              <>
                {locale === 'he' ? 'כניסה למערכת' : 'Enter Terminal'}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-[11px] text-zinc-500">
          {locale === 'he' ? 'כל ניסיונות הגישה מנוטרים ומתועדים.' : 'All access attempts are monitored and logged.'}
        </p>
      </div>
    </div>
  );
}

function LoginFallback() {
  const { locale } = useLocale();
  return (
    <div className="rounded-3xl border border-white/5 bg-zinc-900/60 p-8 shadow-2xl frosted-obsidian">
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-300" aria-hidden />
        <p className="text-xs uppercase tracking-wider text-zinc-500">{locale === 'he' ? 'מכין סשן מאובטח' : 'Preparing Secure Session'}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div
      className="relative isolate flex min-h-screen min-h-[100dvh] w-full max-w-full flex-col items-center justify-center overflow-x-hidden bg-zinc-950 p-6"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_5%_0%,rgba(6,182,212,0.16),transparent_60%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_100%_100%,rgba(16,185,129,0.15),transparent_60%)]" aria-hidden />
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>
      <div className="relative w-full max-w-full flex-shrink-0 sm:max-w-md">
        <Suspense fallback={<LoginFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
