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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-700 border border-zinc-600 hover:bg-zinc-600 text-zinc-100 font-medium text-sm flex items-center justify-between gap-2 touch-manipulation"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="בחר מטבע לחיזוי"
      >
        <span>
          {displayValue}
          {displayLabel !== displayValue && (
            <span className="text-zinc-400 mr-2 font-normal"> — {displayLabel}</span>
          )}
        </span>
        <ChevronDown className={`w-5 h-5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-zinc-800 border border-zinc-600 shadow-xl z-50 max-h-[320px] flex flex-col overflow-hidden">
          <div className="p-2 border-b border-zinc-700 flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש מטבע..."
              className="flex-1 min-w-0 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
              aria-label="חיפוש מטבע"
              dir="rtl"
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
                  className={`w-full text-start px-3 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation ${
                    value === sym
                      ? 'bg-amber-600 text-zinc-900'
                      : 'bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
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
