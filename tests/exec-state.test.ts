import { describe, expect, it } from 'vitest';
import { parseExecState } from '@/lib/db/virtual-portfolio';

describe('parseExecState', () => {
  it('retrieves kellyFraction and scalpTier for tactical recovery', () => {
    const json = JSON.stringify({
      peakUnrealizedPct: 1.2,
      effectiveStopLossPct: -0.5,
      kellyFraction: 0.042,
      scalpTier: 'MODERATE',
      scaleOutDone: false,
    });
    const st = parseExecState(json);
    expect(st.kellyFraction).toBe(0.042);
    expect(st.scalpTier).toBe('MODERATE');
    expect(st.peakUnrealizedPct).toBe(1.2);
    expect(st.effectiveStopLossPct).toBe(-0.5);
    expect(st.scaleOutDone).toBe(false);
  });

  it('rejects invalid scalpTier strings', () => {
    const st = parseExecState('{"scalpTier":"FAKE","kellyFraction":0.1}');
    expect(st.scalpTier).toBeUndefined();
    expect(st.kellyFraction).toBe(0.1);
  });

  it('merges patch semantics: partial updates preserve Kelly when re-read from JSON', () => {
    const base = parseExecState(
      JSON.stringify({ kellyFraction: 0.03, scalpTier: 'CAUTIOUS', peakUnrealizedPct: 0 })
    );
    const patched = { ...base, peakUnrealizedPct: 2.5, effectiveStopLossPct: -0.2 };
    expect(patched.kellyFraction).toBe(0.03);
    expect(patched.scalpTier).toBe('CAUTIOUS');
    expect(patched.peakUnrealizedPct).toBe(2.5);
  });
});
