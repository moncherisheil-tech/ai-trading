'use client';

import { Suspense, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Lock,
  Loader2,
  ShieldCheck,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';

// Only allow /ops paths as redirect targets to prevent open-redirect attacks.
function sanitizeRedirectTarget(from: string | null): string {
  if (!from) return '/ops';
  if (from === '/ops' || from.startsWith('/ops/')) return from;
  return '/ops';
}

type Step = 'password' | 'otp';

// ---------------------------------------------------------------------------
// OTP digit inputs
// ---------------------------------------------------------------------------

interface OtpInputsProps {
  otp: string[];
  loading: boolean;
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  onChange: (index: number, value: string) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}

function OtpInputs({ otp, loading, refs, onChange, onKeyDown, onPaste }: OtpInputsProps) {
  return (
    <div className="flex items-center justify-between gap-2" onPaste={onPaste}>
      {otp.map((digit, i) => (
        <input
          key={i}
          id={`otp-${i}`}
          name={`otp-${i}`}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => onChange(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          disabled={loading}
          aria-label={`Digit ${i + 1} of 6`}
          autoComplete="one-time-code"
          className="h-14 w-full rounded-2xl border border-white/10 bg-zinc-950/80 text-center text-xl font-bold text-cyan-200 caret-transparent outline-none transition-all duration-200 focus:border-cyan-400/60 focus:bg-zinc-900/80 focus:ring-2 focus:ring-cyan-400/35 disabled:opacity-50"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main login form — two-step: password → OTP
// ---------------------------------------------------------------------------

function LoginForm() {
  const searchParams = useSearchParams();

  const [step,     setStep]     = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [otp,      setOtp]      = useState<string[]>(Array(6).fill(''));
  const [nonce,    setNonce]    = useState<string>('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Step 1 — submit master password ────────────────────────────────────────
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/request-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Password is always sent in the request body — NEVER in the URL.
        body:    JSON.stringify({ masterPassword: password.trim() }),
      });

      // Parse body before branching so we always have the server message.
      let data: { error?: string; nonce?: string } = {};
      try { data = await res.json() as typeof data; } catch { /* non-JSON body */ }

      if (!res.ok) {
        if (res.status === 401) {
          setError('Invalid password. Please try again.');
        } else if (res.status >= 500) {
          setError('Server error — please try again in a moment.');
        } else {
          setError(data.error ?? 'Authentication failed.');
        }
        return;
      }

      setNonce(data.nonce ?? '');
      setStep('otp');
      // Autofocus first OTP cell after paint
      setTimeout(() => otpRefs.current[0]?.focus(), 60);
    } catch {
      setError('Connection error. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 — OTP digit handlers ────────────────────────────────────────────
  const handleOtpChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }, []);

  const handleOtpKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const handleOtpPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const next = Array(6).fill('');
    for (let i = 0; i < digits.length; i++) next[i] = digits[i]!;
    setOtp(next);
    otpRefs.current[Math.min(digits.length, 5)]?.focus();
  }, []);

  // ── Step 2 — submit OTP ────────────────────────────────────────────────────
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const code = otp.join('');
    if (code.length < 6) { setError('Enter all 6 digits.'); return; }

    setError(null);
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ otp: code, nonce }),
      });
      const data = await res.json() as { error?: string; redirectTo?: string };
      if (!res.ok) {
        setError(data.error ?? 'Invalid code.');
        setOtp(Array(6).fill(''));
        setTimeout(() => otpRefs.current[0]?.focus(), 40);
        return;
      }
      const target = sanitizeRedirectTarget(searchParams.get('from'));
      window.location.href = data.redirectTo ?? target;
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetToPassword = () => {
    setStep('password');
    setError(null);
    setOtp(Array(6).fill(''));
    setNonce('');
  };

  return (
    <div
      className="frosted-obsidian relative overflow-hidden rounded-3xl border border-white/5 bg-zinc-900/60 p-8 shadow-2xl sm:p-10"
    >
      {/* Ambient glows */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl"    aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -right-20 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />

      <div className="relative">

        {/* ── Header ── */}
        <div className="mb-8 flex items-center justify-between border-b border-white/5 pb-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-2.5 shadow-[0_0_25px_rgba(34,211,238,0.2)]">
              {step === 'password'
                ? <ShieldCheck  className="h-5 w-5 text-cyan-300" aria-hidden />
                : <MessageSquare className="h-5 w-5 text-cyan-300" aria-hidden />
              }
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                {step === 'password' ? 'Institution Access' : 'OOB Verification'}
              </p>
              <h1 className="text-lg font-semibold text-zinc-100">
                {step === 'password' ? 'Terminal Authentication' : 'Telegram One-Time Code'}
              </h1>
            </div>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-emerald-300">
            {step === 'password' ? 'Step 1 / 2' : 'Step 2 / 2'}
          </span>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            STEP 1 — Master Password
        ══════════════════════════════════════════════════════════════════ */}
        {step === 'password' && (
          <>
            <p className="mb-7 text-sm text-zinc-400">
              Enter the Master Password. A one-time code will be dispatched to your
              registered Telegram channel.
            </p>

            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400"
                >
                  Master Password
                </label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors duration-200 group-focus-within:text-cyan-300" />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Enter master password"
                    className="h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/80 pl-11 pr-4 text-zinc-100 placeholder:text-zinc-500 outline-none transition-all duration-200 focus:border-cyan-400/45 focus:ring-2 focus:ring-cyan-400/30"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:border-cyan-400/45 hover:bg-cyan-400/10 hover:text-cyan-200 hover:shadow-[0_0_24px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Sending Code…
                  </>
                ) : (
                  <>
                    Send OTP via Telegram
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                  </>
                )}
              </button>
            </form>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 2 — 6-Digit OTP
        ══════════════════════════════════════════════════════════════════ */}
        {step === 'otp' && (
          <>
            <p className="mb-1.5 text-sm text-zinc-400">
              A 6-digit code was dispatched to your Telegram. Enter it below within{' '}
              <span className="font-medium text-cyan-300">3 minutes</span>.
            </p>
            <p className="mb-7 text-xs text-zinc-500">
              Check your Telegram for a message from the Quantum bot.
            </p>

            <form onSubmit={handleOtpSubmit} className="space-y-6">
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  Verification Code
                </label>
                <OtpInputs
                  otp={otp}
                  loading={loading}
                  refs={otpRefs}
                  onChange={handleOtpChange}
                  onKeyDown={handleOtpKeyDown}
                  onPaste={handleOtpPaste}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || otp.join('').length < 6}
                className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:border-cyan-400/45 hover:bg-cyan-400/10 hover:text-cyan-200 hover:shadow-[0_0_24px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Verifying…
                  </>
                ) : (
                  <>
                    Verify &amp; Access Terminal
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={resetToPassword}
                className="inline-flex w-full items-center justify-center gap-1.5 text-xs text-zinc-500 transition-colors duration-200 hover:text-zinc-300"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                Request a new code
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-[11px] text-zinc-500">
          All access attempts are monitored and logged.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton shown while the Suspense boundary resolves useSearchParams
// ---------------------------------------------------------------------------

function LoginFallback() {
  return (
    <div className="frosted-obsidian rounded-3xl border border-white/5 bg-zinc-900/60 p-8 shadow-2xl">
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-300" aria-hidden />
        <p className="text-xs uppercase tracking-wider text-zinc-500">Preparing Secure Session</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export default function LoginPage() {
  return (
    <div
      className="relative isolate flex min-h-screen min-h-[100dvh] w-full flex-col items-center justify-center overflow-x-hidden bg-zinc-950 p-6"
      style={{
        paddingTop:    'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft:   'max(1rem, env(safe-area-inset-left))',
        paddingRight:  'max(1rem, env(safe-area-inset-right))',
      }}
    >
      {/* Radial ambient gradients */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_5%_0%,rgba(6,182,212,0.16),transparent_60%)]"    aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_100%_100%,rgba(16,185,129,0.15),transparent_60%)]" aria-hidden />

      <div className="relative w-full max-w-full flex-shrink-0 sm:max-w-md">
        <Suspense fallback={<LoginFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
