'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquare } from 'lucide-react';

interface Message {
  role: 'user' | 'overseer';
  text: string;
  at: string;
}

export default function ExecutiveChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    const userMsg: Message = { role: 'user', text, at: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setSending(true);
    try {
      const res = await fetch('/api/overseer/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      const reply =
        res.ok && data.reply
          ? data.reply
          : data.error || 'לא התקבלה תשובה. נסה שוב.';
      setMessages((m) => [
        ...m,
        { role: 'overseer', text: reply, at: new Date().toISOString() },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'overseer', text: 'שגיאת רשת. נסה שוב.', at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="rounded-xl border border-cyan-900/50 bg-[#07192d]/80 overflow-hidden flex flex-col min-w-0 w-full"
      dir="rtl"
      aria-label="צ&apos;אט מנהלים עם המפקח העליון"
    >
      <div className="p-4 border-b border-cyan-900/50 bg-[#07192d]/60 flex items-center gap-2 min-w-0 shrink-0">
        <MessageSquare className="w-5 h-5 text-cyan-400 shrink-0" />
        <h3 className="text-lg font-semibold text-cyan-100 truncate">צ&apos;אט מנהלים — מפקח עליון</h3>
      </div>
      <div className="flex-1 min-h-[280px] max-h-[400px] overflow-y-auto overflow-x-hidden p-4 space-y-3 min-w-0">
        {messages.length === 0 && (
          <p className="text-cyan-200/70 text-sm text-center py-8">
            שלח הודעה לקבלת סטטוס סיכון ותיק בעברית. המפקח העליון מגיב בהתבסס על נתוני מערכת חיים.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
          >
            <div
              className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm break-words ${
                msg.role === 'user'
                  ? 'bg-cyan-900/40 text-cyan-50 border border-cyan-800/50'
                  : 'bg-[#0a1628] text-cyan-100 border border-cyan-700/50'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-end">
            <div className="rounded-lg px-3 py-2 bg-[#0a1628] border border-cyan-700/50 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              <span className="text-cyan-200/80 text-sm">מפקח מגיב…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-cyan-900/50 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="הודעה למפקח עליון…"
          className="flex-1 px-3 py-2 rounded-lg bg-[#07192d] border border-cyan-900/50 text-cyan-50 placeholder:text-cyan-500/60 focus:ring-2 focus:ring-cyan-400/50 focus:border-cyan-400/50 text-sm"
          dir="rtl"
          disabled={sending}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="p-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:pointer-events-none text-white transition-colors"
          aria-label="שלח"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
