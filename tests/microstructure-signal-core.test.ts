import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeBinanceAggTrades } from '@/lib/api-utils';
import { isSignalCoreEnabled, postMicrostructure } from '@/lib/microstructure/signal-core-client';

describe('normalizeBinanceAggTrades', () => {
  it('parses valid Binance aggTrades rows', () => {
    const rows = [
      { p: '100.5', q: '1.5', T: 1700000000000, m: false },
      { p: '99.25', q: '2', T: 1700000001000, m: true },
    ];
    const out = normalizeBinanceAggTrades(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ price: 100.5, qty: 1.5, is_buyer_maker: false });
    expect(out[1]).toMatchObject({ price: 99.25, qty: 2, is_buyer_maker: true });
  });

  it('drops invalid rows and non-arrays', () => {
    expect(normalizeBinanceAggTrades(null)).toEqual([]);
    expect(normalizeBinanceAggTrades([{ p: 'x', q: '1', T: 1, m: false }])).toEqual([]);
  });
});

describe('isSignalCoreEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false without URL', () => {
    vi.stubEnv('SIGNAL_CORE_URL', '');
    vi.stubEnv('SIGNAL_CORE_ENABLED', '1');
    expect(isSignalCoreEnabled()).toBe(false);
  });

  it('is false when URL set but enabled not on', () => {
    vi.stubEnv('SIGNAL_CORE_URL', 'http://127.0.0.1:8765');
    vi.stubEnv('SIGNAL_CORE_ENABLED', '0');
    expect(isSignalCoreEnabled()).toBe(false);
  });

  it('is true when URL and SIGNAL_CORE_ENABLED=1', () => {
    vi.stubEnv('SIGNAL_CORE_URL', 'http://127.0.0.1:8765');
    vi.stubEnv('SIGNAL_CORE_ENABLED', '1');
    expect(isSignalCoreEnabled()).toBe(true);
  });

  it('accepts true (case insensitive)', () => {
    vi.stubEnv('SIGNAL_CORE_URL', 'http://127.0.0.1:8765');
    vi.stubEnv('SIGNAL_CORE_ENABLED', 'true');
    expect(isSignalCoreEnabled()).toBe(true);
  });
});

describe('postMicrostructure timeout / failover', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns null when fetch never completes before SIGNAL_CORE_TIMEOUT_MS (race; no throw)', async () => {
    vi.stubEnv('SIGNAL_CORE_URL', 'http://127.0.0.1:8765');
    vi.stubEnv('SIGNAL_CORE_ENABLED', '1');
    vi.stubEnv('SIGNAL_CORE_TIMEOUT_MS', '150');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>(() => {
          /* simulates server slower than client budget (e.g. 9s vs 8s default) */
        })
    );

    const result = await postMicrostructure({ trades: [] });
    expect(result).toBeNull();
  });
});
