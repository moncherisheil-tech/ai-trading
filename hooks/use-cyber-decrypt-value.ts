'use client';

import { useEffect, useRef, useState } from 'react';

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

function scrambleText(target: string, width: number): string {
  const w = Math.max(width, target.length);
  let out = '';
  for (let i = 0; i < w; i++) {
    const ch = target[i];
    if (ch === '.' || ch === '-' || ch === ',') {
      out += ch ?? randomDigit();
    } else if (ch !== undefined && /\d/.test(ch)) {
      out += randomDigit();
    } else {
      out += ch ?? randomDigit();
    }
  }
  return out;
}

/**
 * Matrix-style numeric decrypt: scrambles until `value` is stable, then locks with optional decimals.
 */
export function useCyberDecryptNumber(value: number | null | undefined, options?: { decimals?: number }) {
  const decimals = options?.decimals ?? 1;
  const [display, setDisplay] = useState<string>(() => (value == null ? '—' : '···'));
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (value == null) {
      setDisplay('—');
      return;
    }
    const target = value.toFixed(decimals);
    let frames = 0;
    const maxFrames = 18 + Math.floor(Math.random() * 10);
    const tick = () => {
      frames += 1;
      if (frames >= maxFrames) {
        setDisplay(target);
        return;
      }
      setDisplay(scrambleText(target, target.length));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, decimals]);

  return display;
}
