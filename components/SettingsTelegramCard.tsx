'use client';

import { useState, useEffect } from 'react';
import { Send, Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function SettingsTelegramCard() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');

  useEffect(() => {
    fetch('/api/ops/telegram/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setConnected(Boolean(data?.connected)))
      .catch(() => setConnected(false));
  }, []);

  const handleTest = async (
    variant: 'connection' | 'system' | 'trade' | 'integration' = 'connection'
  ) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ops/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(token.trim() && chatId.trim() ? { token: token.trim(), chatId: chatId.trim() } : {}),
          variant,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: 'שגיאת רשת' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">חיבור טלגרם</h2>
        {connected !== null && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
              connected ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30' : 'bg-slate-600/50 text-slate-400'
            }`}
          >
            {connected ? 'חובר' : 'מנותק'}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-400">
        להגדרה: הוסף TELEGRAM_BOT_TOKEN ו-TELEGRAM_CHAT_ID ל־.env או להגדרות Vercel. אופציונלי: הזן כאן לבדיקה בלבד (לא נשמר).
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tg-token" className="block text-xs font-medium text-slate-500 mb-1">
            טוקן בוט (אופציונלי לבדיקה)
          </label>
          <input
            id="tg-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
        <div>
          <label htmlFor="tg-chat" className="block text-xs font-medium text-slate-500 mb-1">
            מזהה צ'אט (אופציונלי לבדיקה)
          </label>
          <input
            id="tg-chat"
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="123456789"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleTest('integration')}
          disabled={testing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          title="Send: 🟢 Telegram Integration Active & Working!"
        >
          {testing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              שולח...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Test Telegram
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleTest('connection')}
          disabled={testing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-60 text-slate-100 text-sm font-medium transition-colors"
        >
          בדוק חיבור
        </button>
        <button
          type="button"
          onClick={() => handleTest('system')}
          disabled={testing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-60 text-slate-100 text-sm font-medium transition-colors"
          title="שלח הודעת מערכת (System Online)"
        >
          🟢 מערכת פועלת
        </button>
        <button
          type="button"
          onClick={() => handleTest('trade')}
          disabled={testing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-60 text-slate-100 text-sm font-medium transition-colors"
          title="שלח סימולציית עסקה (Test Trade)"
        >
          📊 בדיקת עסקה
        </button>
      </div>
      {testResult && (
        <div
          className={`flex items-center gap-2 text-sm ${
            testResult.ok ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {testResult.ok ? (
            <>
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              הודעת בדיקה נשלחה בהצלחה.
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 shrink-0" />
              {testResult.error || 'השליחה נכשלה'}
            </>
          )}
        </div>
      )}
    </div>
  );
}
