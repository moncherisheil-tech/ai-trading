'use client';

import { useState, useEffect } from 'react';
import { Send, Loader2, CheckCircle2, XCircle, Info } from 'lucide-react';
import { getTelegramStatusAction, testTelegramAction } from '@/app/actions';

const TOOLTIP_TOKEN =
  'מתקבל מ־@BotFather בטלגרם: /newbot → העתק את ה־API Token.';
const TOOLTIP_CHAT_ID =
  'מזהה הצ\'אט: שלח הודעה לבוט ואז פתח: https://api.telegram.org/bot<TOKEN>/getUpdates וחפש את "chat":{"id":...}';

export default function SettingsTelegramCard() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');

  useEffect(() => {
    void (async () => {
      const out = await getTelegramStatusAction();
      if (!out.success) {
        setConnected(false);
        return;
      }
      setConnected(Boolean((out.data as any)?.connected));
    })();
  }, []);

  const handleTest = async (
    variant: 'connection' | 'system' | 'trade' | 'integration' = 'connection'
  ) => {
    setTesting(true);
    setTestResult(null);
    try {
      const out = await testTelegramAction({ variant, token, chatId });
      if (out.success) setTestResult(out.data as any);
      else setTestResult({ ok: false, error: out.error });
    } catch {
      setTestResult({ ok: false, error: 'שגיאת רשת' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-100">חיבור טלגרם</h2>
        {connected !== null && (
          <span
            role="status"
            aria-label={connected ? 'חיבור טלגרם פעיל' : 'טלגרם מנותק'}
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
          <label htmlFor="tg-token" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
            טוקן בוט (אופציונלי לבדיקה)
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-600/80 text-slate-400 cursor-help"
              title={TOOLTIP_TOKEN}
              aria-label={TOOLTIP_TOKEN}
            >
              <Info className="w-3 h-3" />
            </span>
          </label>
          <input
            id="tg-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          />
        </div>
        <div>
          <label htmlFor="tg-chat" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
            מזהה צ&apos;אט (אופציונלי לבדיקה)
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-600/80 text-slate-400 cursor-help"
              title={TOOLTIP_CHAT_ID}
              aria-label={TOOLTIP_CHAT_ID}
            >
              <Info className="w-3 h-3" />
            </span>
          </label>
          <input
            id="tg-chat"
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="123456789"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => handleTest('integration')}
          disabled={testing}
          aria-label="בדוק חיבור טלגרם — שלח הודעת בדיקה"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          title="שולח הודעת בדיקה: אינטגרציה פעילה"
        >
          {testing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              שולח...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              בדוק חיבור טלגרם
            </>
          )}
        </button>
        <span
          role="status"
          aria-label="סטטוס מערכת"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-700/80 text-slate-400"
        >
          🟢 מערכת פועלת
        </span>
        <button
          type="button"
          onClick={() => handleTest('trade')}
          disabled={testing}
          aria-label="שלח סימולציית עסקה לבדיקה"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-60 text-slate-100 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
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
