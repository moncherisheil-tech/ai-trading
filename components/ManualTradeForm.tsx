'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToastOptional } from '@/context/ToastContext';
import { formatAmountForSymbol, formatPriceForSymbol } from '@/lib/decimal';
import { closeVirtualPortfolioTradeAction, createVirtualPortfolioTradeAction } from '@/app/actions';

type Side = 'buy' | 'sell';

export default function ManualTradeForm() {
  const toast = useToastOptional();
  const [symbol, setSymbol] = useState('');
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolSuggestions, setSymbolSuggestions] = useState<string[]>([]);
  const [amountUsd, setAmountUsd] = useState<string>('');
  const [side, setSide] = useState<Side>('buy');
  const [slPct, setSlPct] = useState<string>('');
  const [tpPct, setTpPct] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback((q: string) => {
    if (!q || q.length < 1) {
      setSymbolSuggestions([]);
      return;
    }
    const normalized = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalized) {
      setSymbolSuggestions([]);
      return;
    }
    fetch(`/api/crypto/symbols?q=${encodeURIComponent(normalized)}`)
      .then((res) => (res.ok ? res.json() : { symbols: [] }))
      .then((data: { symbols?: string[] }) => setSymbolSuggestions(data.symbols ?? []))
      .catch(() => setSymbolSuggestions([]));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(symbolQuery), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [symbolQuery, fetchSuggestions]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setSuggestionsOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawSymbol = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sym = rawSymbol.endsWith('USDT') ? rawSymbol : `${rawSymbol}USDT`;
    const amount = parseFloat(amountUsd);
    if (!sym || !Number.isFinite(amount) || amount <= 0) {
      toast?.error('נא להזין סמל תקף וסכום בדולר.');
      return;
    }

    setLoading(true);
    try {
      if (side === 'buy') {
        const body: Record<string, unknown> = { symbol: sym, amount_usd: amount };
        const sl = parseFloat(slPct);
        const tp = parseFloat(tpPct);
        if (Number.isFinite(tp) && tp > 0) body.target_profit_pct = tp;
        if (Number.isFinite(sl) && sl < 0) body.stop_loss_pct = sl;
          const out = await createVirtualPortfolioTradeAction(body as {
            symbol: string;
            amount_usd: number;
            target_profit_pct?: number;
            stop_loss_pct?: number;
          });
          if (out.success) {
            const data = out.data as {
              success?: boolean;
              error?: string;
              entry_price?: number;
              amount_usd?: number;
              symbol?: string;
            };
            if (data.entry_price != null && data.amount_usd != null && data.symbol) {
              const units = data.amount_usd / data.entry_price;
              const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              toast?.success(
                `נרכשו ${formatAmountForSymbol(units, data.symbol)} של ${data.symbol.replace('USDT', '')} בשעה ${timeStr} (מחיר ${formatPriceForSymbol(data.entry_price, data.symbol)} $)`
              );
              setAmountUsd('');
              setSymbol('');
              setSymbolQuery('');
              setSlPct('');
              setTpPct('');
            } else {
              toast?.error('פתיחת עסקה נכשלה.');
            }
          } else {
            toast?.error(out.error || 'פתיחת עסקה נכשלה.');
          }
      } else {
          const out = await closeVirtualPortfolioTradeAction({ symbol: sym });
          if (out.success) {
            toast?.success(`נסגרה פוזיציה עבור ${sym.replace('USDT', '')}.`);
            setSymbol('');
            setSymbolQuery('');
          } else {
            toast?.error(out.error || 'סגירת פוזיציה נכשלה.');
          }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בביצוע העסקה';
      toast?.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const displaySymbol = symbol || symbolQuery;
  const formFieldClass =
    'w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500';
  const numericFieldClass = `${formFieldClass} tabular-nums`;
  const selectFieldClass = `${formFieldClass} appearance-none`;

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-white/5 bg-[#111111] p-6 space-y-4" dir="rtl">
      <h3 className="text-sm font-bold text-white">עסקה ידנית (תיק וירטואלי)</h3>

      <div className="relative" ref={listRef}>
        <label className="block text-xs text-zinc-500 mb-1">סמל</label>
        <input
          type="text"
          value={symbolQuery || symbol}
          onChange={(e) => {
            setSymbolQuery(e.target.value);
            setSuggestionsOpen(true);
            if (!e.target.value) setSymbol('');
          }}
          onFocus={() => setSuggestionsOpen(true)}
          placeholder="BTC, ETH, ..."
          className={formFieldClass}
          aria-autocomplete="list"
        />
        {suggestionsOpen && symbolSuggestions.length > 0 && (
          <ul
            className="absolute top-full start-0 end-0 mt-1 rounded-xl bg-[#111111] border border-white/10 shadow-xl z-[var(--z-dropdown)] max-h-48 overflow-auto py-1"
            role="listbox"
          >
            {symbolSuggestions.map((s) => (
              <li key={s} role="option" aria-selected={symbol === s}>
                <button
                  type="button"
                  onClick={() => {
                    setSymbol(s);
                    setSymbolQuery(s);
                    setSuggestionsOpen(false);
                  }}
                  className="w-full text-right px-4 py-2 text-sm text-white hover:bg-white/10"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">סכום (USD)</label>
        <input
          type="number"
          min="1"
          step="1"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          placeholder="100"
          className={numericFieldClass}
        />
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">כיוון</label>
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as Side)}
          className={selectFieldClass}
        >
          <option value="buy">קנייה</option>
          <option value="sell">מכירה (סגירת פוזיציה)</option>
        </select>
      </div>

      {side === 'buy' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">סטופ לוס (%) — אופציונלי</label>
              <input
                type="number"
                step="0.5"
                value={slPct}
                onChange={(e) => setSlPct(e.target.value)}
                placeholder="-2"
                className={numericFieldClass}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">יעד רווח (%) — אופציונלי</label>
              <input
                type="number"
                step="0.5"
                value={tpPct}
                onChange={(e) => setTpPct(e.target.value)}
                placeholder="5"
                className={numericFieldClass}
              />
            </div>
          </div>
        </>
      )}

      <button
        type="submit"
        disabled={loading || !displaySymbol || (side === 'buy' && (!amountUsd || parseFloat(amountUsd) <= 0))}
        className="w-full rounded-xl bg-amber-500 hover:bg-amber-500/90 text-black font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {loading ? 'מבצע...' : side === 'buy' ? 'פתח עסקה (קנייה)' : 'סגור פוזיציה'}
      </button>
    </form>
  );
}
