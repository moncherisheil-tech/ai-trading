'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { CRYPTO_SYMBOLS, getLabelHe } from '@/lib/symbols';

type SymbolSelectProps = {
  value: string;
  onChange: (symbol: string) => void;
  placeholder?: string;
  className?: string;
  /** When set, only these base symbols are shown (Gem Finder: liquidity ≥ $50k, 24h volume ≥ $100k). */
  gemBaseSymbols?: string[] | null;
};

export default function SymbolSelect({ value, onChange, placeholder = 'בחר מטבע', className = '', gemBaseSymbols }: SymbolSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const baseList = useMemo(() => {
    if (gemBaseSymbols && gemBaseSymbols.length > 0) {
      return CRYPTO_SYMBOLS.filter((s) => gemBaseSymbols.includes(s));
    }
    return [...CRYPTO_SYMBOLS];
  }, [gemBaseSymbols]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return baseList;
    return baseList.filter((s) => {
      const label = getLabelHe(s).toLowerCase();
      return s.toLowerCase().includes(q) || label.includes(q);
    });
  }, [search, baseList]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [open]);

  const displayValue = value || 'BTC';
  const displayLabel = getLabelHe(displayValue);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <label id="crypto-symbol-select-label" className="sr-only">בחר מטבע לניתוח</label>
      <button
        id="crypto-symbol-select"
        name="selectedSymbol"
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-terminal-secondary w-full min-w-0 min-h-[44px] px-4 py-2.5 rounded-xl font-medium text-sm flex items-center justify-between gap-2 touch-manipulation focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="crypto-symbol-select-label"
        aria-label="בחר מטבע לחיזוי"
      >
        <span>
          {displayValue}
          {displayLabel !== displayValue && (
            <span className="text-zinc-500 me-2 font-normal"> — {displayLabel}</span>
          )}
        </span>
        <ChevronDown className={`w-5 h-5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="ui-panel-dense absolute top-full start-0 end-0 mt-1 shadow-xl z-[var(--z-dropdown)] max-h-[320px] flex flex-col overflow-hidden p-0">
          <div className="p-2 border-b border-white/5 flex items-center gap-2">
            <label htmlFor="crypto-symbol-search" className="sr-only">חיפוש מטבע</label>
            <Search className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
            <input
              id="crypto-symbol-search"
              name="symbolSearch"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש מטבע..."
              className="flex-1 min-w-0 bg-[#050505] border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:ring-2 focus:ring-amber-500/50 focus:outline-none transition-all duration-200"
              aria-label="חיפוש מטבע"
              dir="rtl"
              autoComplete="off"
            />
          </div>
          <ul
            className="overflow-auto flex-1 p-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1"
            role="listbox"
          >
            {filtered.map((sym) => (
              <li key={sym} role="option" aria-selected={value === sym}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(sym);
                    setOpen(false);
                    setSearch('');
                  }}
                  aria-label={`בחר מטבע ${sym}`}
                  className={`w-full text-start px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                    value === sym
                      ? 'bg-amber-500/20 text-amber-500 border border-amber-500/20'
                      : 'bg-white/[0.02] text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  {sym}
                  {getLabelHe(sym) !== sym && (
                    <span className="text-xs opacity-80 block truncate">{getLabelHe(sym)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-zinc-500 text-center">לא נמצאו מטבעות</p>
          )}
        </div>
      )}
    </div>
  );
}
