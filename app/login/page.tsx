'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2, Shield } from 'lucide-react';
import { loginWithPassword } from '@/app/actions';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/ops';
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
        const target = result.redirectTo || from || '/ops';
        // Force full navigation so the new cookie is sent and session is recognized (avoids Verifying hang)
        if (typeof window !== 'undefined') {
          window.location.href = target;
        } else {
          router.refresh();
          router.push(target);
        }
        return;
      }
      setError(result.error);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-700/80 bg-zinc-900/95 shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800/80 border-b border-zinc-700/80">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
        </div>
        <span className="text-xs text-zinc-500 font-mono ml-2">secure_session</span>
      </div>

      <div className="p-6 sm:p-8">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Shield className="w-6 h-6 text-emerald-500/90" aria-hidden />
          <h1 className="text-lg font-semibold text-zinc-100 tracking-tight text-center">
            AI Intelligence Terminal
          </h1>
        </div>
        <p className="text-xs text-zinc-500 text-center mb-8">Secure Access</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-zinc-400 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" aria-hidden />
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter access key"
                className="w-full pl-10 pr-4 py-3 rounded-lg bg-zinc-800/80 border border-zinc-600/80 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors"
                required
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                Verifying…
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" aria-hidden />
                Secure Login
              </>
            )}
          </button>
        </form>

        <p className="text-[10px] text-zinc-600 text-center mt-6">
          Authorized access only. All activity is logged.
        </p>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="rounded-lg border border-zinc-700/80 bg-zinc-900/95 shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800/80 border-b border-zinc-700/80">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
        </div>
        <span className="text-xs text-zinc-500 font-mono ml-2">secure_session</span>
      </div>
      <div className="p-6 sm:p-8 flex flex-col items-center justify-center min-h-[280px]">
        <Loader2 className="w-8 h-8 text-emerald-500/70 animate-spin mb-4" aria-hidden />
        <p className="text-xs text-zinc-500">Loading…</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <Suspense fallback={<LoginFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
