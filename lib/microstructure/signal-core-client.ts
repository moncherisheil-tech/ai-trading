/**
 * HTTP client for Python Signal Core (CVD, entropy, Kalman).
 * Opt-in: set SIGNAL_CORE_URL and SIGNAL_CORE_ENABLED=1 (or true).
 */

export type SignalCoreTrade = {
  price: number;
  qty: number;
  is_buyer_maker: boolean;
  time: number;
};

export type SignalCoreWindowMeta = {
  trade_count: number;
  first_trade_ms: number | null;
  last_trade_ms: number | null;
  close_count: number;
};

export type SignalCoreResponse = {
  cvd_last_n: number;
  cvd_slope: number;
  order_flow_imbalance_approx: number | null;
  entropy_returns: number | null;
  entropy_volume_bins: number | null;
  kalman_level: number | null;
  kalman_velocity: number | null;
  noise_flag: boolean;
  window_meta: SignalCoreWindowMeta;
  raw?: Record<string, unknown>;
};

export type SignalCoreRequestBody = {
  trades: SignalCoreTrade[];
  closes?: number[];
  volumes?: number[];
  entropy_return_bins?: number;
  noise_entropy_ratio_threshold?: number;
  kalman_process_var?: number;
  kalman_obs_var?: number;
};

function signalCoreBaseUrl(): string {
  return (process.env.SIGNAL_CORE_URL || '').trim().replace(/\/$/, '');
}

function signalCoreTimeoutMs(): number {
  const n = Number(process.env.SIGNAL_CORE_TIMEOUT_MS);
  /** Allow 100ms+ for tests; default 8s when unset or out of range. */
  if (Number.isFinite(n) && n >= 100 && n <= 60_000) return n;
  return 8_000;
}

/** True when URL is set and enable flag is on (explicit opt-in). */
export function isSignalCoreEnabled(): boolean {
  const url = signalCoreBaseUrl();
  if (!url) return false;
  const en = (process.env.SIGNAL_CORE_ENABLED || '').trim().toLowerCase();
  return en === '1' || en === 'true' || en === 'yes';
}

/**
 * POST /v1/microstructure. Returns null if disabled, bad response, or network error.
 */
export async function postMicrostructure(body: SignalCoreRequestBody): Promise<SignalCoreResponse | null> {
  if (!isSignalCoreEnabled()) return null;
  const base = signalCoreBaseUrl();
  const url = `${base}/v1/microstructure`;
  const timeoutMs = signalCoreTimeoutMs();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('SIGNAL_CORE_CLIENT_TIMEOUT'));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      }),
      timeoutPromise,
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = (await res.json()) as SignalCoreResponse;
    if (
      data == null ||
      typeof data !== 'object' ||
      typeof data.cvd_last_n !== 'number' ||
      typeof data.cvd_slope !== 'number' ||
      typeof data.noise_flag !== 'boolean' ||
      data.window_meta == null
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Compact bilingual-safe line for LLM experts (numbers LTR). */
export function formatMicrostructureForConsensus(r: SignalCoreResponse | null): string | null {
  if (!r) return null;
  const imb = r.order_flow_imbalance_approx;
  const imbStr =
    imb != null && Number.isFinite(imb) ? `${(imb * 100).toFixed(1)}% buy-aggressor skew` : 'n/a';
  const hRet = r.entropy_returns != null && Number.isFinite(r.entropy_returns) ? r.entropy_returns.toFixed(4) : 'n/a';
  const hVol =
    r.entropy_volume_bins != null && Number.isFinite(r.entropy_volume_bins)
      ? r.entropy_volume_bins.toFixed(4)
      : 'n/a';
  const kLvl =
    r.kalman_level != null && Number.isFinite(r.kalman_level) ? r.kalman_level.toPrecision(6) : 'n/a';
  const kVel =
    r.kalman_velocity != null && Number.isFinite(r.kalman_velocity) ? r.kalman_velocity.toExponential(2) : 'n/a';
  return [
    'Microstructure (CVD/entropy/Kalman):',
    `CVD_end=${r.cvd_last_n.toFixed(6)}`,
    `CVD_slope=${r.cvd_slope.toExponential(3)}`,
    `flow_imbalance≈${imbStr}`,
    `H(log_returns)=${hRet} nats`,
    `H(log_vol_bins)=${hVol}`,
    `Kalman_lvl≈${kLvl}`,
    `Kalman_dlog=${kVel}`,
    r.noise_flag ? 'NOISE_FLAG=HIGH (choppy / uncertain micro)' : 'NOISE_FLAG=normal',
    `(agg_trades=${r.window_meta.trade_count}, closes=${r.window_meta.close_count})`,
  ].join(' ');
}

/**
 * Fetches metrics from Signal Core given live trades and optional OHLC arrays.
 */
export async function fetchMicrostructureSummary(params: {
  trades: SignalCoreTrade[];
  closes?: number[];
  volumes?: number[];
}): Promise<string | null> {
  const res = await postMicrostructure({
    trades: params.trades,
    closes: params.closes?.filter((c) => Number.isFinite(c) && c > 0),
    volumes: params.volumes?.filter((v) => Number.isFinite(v) && v >= 0),
  });
  return formatMicrostructureForConsensus(res);
}
