'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';

type ConsultationMessage = {
  role: 'user' | 'assistant';
  text: string;
  data?: {
    symbol: string;
    currentSignal: string;
    technicalSetup: { rsi: number; ema20: number | null; ema50: number | null; priceAboveEma20: boolean; bullishTrend: boolean; price: number };
    confidenceScore: number;
    reasoning: string;
  };
};

function extractSymbol(query: string): string | null {
  const trimmed = query.trim();
  const match = trimmed.match(/(?:מה (?:דעתך|הדעה שלך)|what is your take|your take)\s+on\s+(\w+)/i)
    || trimmed.match(/(\b[A-Z]{2,10}\b)/i)
    || trimmed.match(/(?:סמל|symbol)\s*[:\s]*(\w+)/i);
  return match ? match[1]!.toUpperCase() : null;
}

export default function ConsultationChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ConsultationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const symbol = extractSymbol(text) || text.replace(/\s/g, '').toUpperCase().slice(0, 10);
    if (!symbol) {
      setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: 'נא לציין סמל מטבע (למשל BTC או "מה דעתך על BTC").' }]);
      setInput('');
      return;
    }
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch(`/api/consultation?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'assistant', text: data.error || 'שגיאה בטעינת הייעוץ.' }]);
        return;
      }
      const setup = data.technicalSetup || {};
      const reply = [
        `**איתות נוכחי:** ${data.currentSignal === 'Buy' ? 'קנייה' : data.currentSignal === 'Sell' ? 'מכירה' : 'המתנה'}`,
        `**מערך טכני:** מדד עוצמה יחסית (RSI) ${setup.rsi ?? '—'}, ממוצע נע מעריכי (EMA 20/50): ${setup.ema20 != null ? setup.ema20.toFixed(2) : '—'} / ${setup.ema50 != null ? setup.ema50.toFixed(2) : '—'}, מחיר ${setup.priceAboveEma20 ? 'מעל' : 'מתחת'} EMA 20${setup.bullishTrend ? ', מגמה שורית' : ''}.`,
        `**מדד ביטחון:** ${data.confidenceScore ?? 0}/100 (מבוסס על הצלחה היסטורית).`,
        `**נימוק:** ${data.reasoning || ''}`,
      ].join('\n\n');
      setMessages((m) => [...m, { role: 'assistant', text: reply, data }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'שגיאה בתקשורת עם שרת הייעוץ.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 start-6 z-[var(--z-dropdown)] flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-black shadow-lg hover:bg-amber-400 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
        aria-label="פתח ייעוץ AI"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center sm:items-center sm:p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden />
          <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#111111] shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[70vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">ייעוץ מסחר — Smart Money</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
                aria-label="סגור"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <p className="text-sm text-zinc-500 text-center py-4">
                  שאל למשל: &quot;מה דעתך על BTC?&quot; או &quot;What is your take on ETH?&quot;
                </p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-4 py-2.5 ${
                    msg.role === 'user' ? 'bg-amber-500/20 text-white me-0 ms-8' : 'bg-white/5 text-zinc-200 me-8 ms-0'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">טוען ייעוץ...</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="מה דעתך על [סמל]?"
                  className="flex-1 rounded-xl border border-white/10 bg-[#0a0a0a] px-4 py-2.5 text-white placeholder-zinc-500 focus:ring-2 focus:ring-amber-500/50"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="rounded-xl bg-amber-500 px-4 py-2.5 text-black font-medium hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
