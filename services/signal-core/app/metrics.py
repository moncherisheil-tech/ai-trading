"""
Microstructure metrics: CVD, Shannon entropy, 1D Kalman on log-price.

CVD sign (Binance isBuyerMaker):
- is_buyer_maker True  -> buyer was maker -> aggressor was seller -> subtract qty
- is_buyer_maker False -> buyer was taker (aggressor buy) -> add qty
"""

from __future__ import annotations

import math

import numpy as np

from app.schemas import MicrostructureRequest, MicrostructureResponse, TradeTick, WindowMeta

EPS = 1e-12


def signed_volume_from_trade(t: TradeTick) -> float:
    """Aggressor-signed base volume for CVD."""
    q = float(t.qty)
    if q <= 0:
        return 0.0
    return -q if t.is_buyer_maker else q


def _trade_qty_and_maker_mask(trades: list[TradeTick]) -> tuple[np.ndarray, np.ndarray]:
    """
    Materialize trade list to arrays (required once per request). All CVD / flow math
    below uses vectorized NumPy only (no per-trade Python aggregation loops).
    """
    if not trades:
        return np.array([], dtype=np.float64), np.array([], dtype=np.bool_)
    qty = np.asarray([float(t.qty) for t in trades], dtype=np.float64)
    maker = np.asarray([bool(t.is_buyer_maker) for t in trades], dtype=np.bool_)
    return qty, maker


def _trades_cvd_buy_sell(trades: list[TradeTick]) -> tuple[np.ndarray, float, float]:
    """CVD series + aggressor buy/sell volumes (vectorized from qty, maker)."""
    qty, maker = _trade_qty_and_maker_mask(trades)
    if qty.size == 0:
        return np.array([], dtype=np.float64), 0.0, 0.0
    signed = np.where(maker, -qty, qty)
    cvd = np.cumsum(signed)
    buy_vol = float(np.sum(qty[~maker]))
    sell_vol = float(np.sum(qty[maker]))
    return cvd, buy_vol, sell_vol


def compute_cvd_series(trades: list[TradeTick]) -> np.ndarray:
    """CVD = cumsum(signed_qty). Maker buy (is_buyer_maker=True) => seller aggressor => negative contribution."""
    cvd, _, _ = _trades_cvd_buy_sell(trades)
    return cvd


def linear_slope(y: np.ndarray) -> float:
    """OLS slope of y vs 0..n-1."""
    n = y.size
    if n < 2:
        return 0.0
    x = np.arange(n, dtype=np.float64)
    x_mean = (n - 1) / 2.0
    y_mean = float(np.mean(y))
    denom = float(np.sum((x - x_mean) ** 2)) or EPS
    return float(np.sum((x - x_mean) * (y - y_mean)) / denom)


def shannon_entropy_discrete(values: np.ndarray, n_bins: int) -> float | None:
    """Shannon H in nats for histogram of values (finite, 1D). Degenerate (constant) => exactly 0.0."""
    v = values[np.isfinite(values)]
    if v.size < 3:
        return None
    # Flatline / single mass: H(X) = 0 (no uncertainty). Avoid log(p+eps) bias.
    if v.size > 0 and float(np.max(v) - np.min(v)) == 0.0:
        return 0.0
    hist, _ = np.histogram(v, bins=n_bins)
    total = float(np.sum(hist))
    if total <= 0:
        return None
    p = hist.astype(np.float64) / total
    mask = p > 0
    p = p[mask]
    # H = -sum p_i log(p_i); p_i > 0 only (standard; log(1)=0 gives exact 0.0 for single bin)
    return float(-np.sum(p * np.log(p)))


def shannon_entropy_normalized(values: np.ndarray, n_bins: int) -> tuple[float | None, float | None]:
    """Returns (H in nats, H / log(n_bins) ratio in [0,1] approximately)."""
    h = shannon_entropy_discrete(values, n_bins)
    if h is None:
        return None, None
    max_h = math.log(n_bins) if n_bins > 1 else 1.0
    ratio = h / max_h if max_h > 0 else None
    return h, ratio


def kalman_log_price_1d(
    log_closes: np.ndarray, process_var: float, obs_var: float
) -> tuple[np.ndarray, np.ndarray]:
    """
    Random-walk local-level model on scalar observations.
    x_t = x_{t-1} + w, z_t = x_t + v. Returns (x_filter, innovation).
    """
    n = log_closes.size
    if n == 0:
        return np.array([]), np.array([])
    x = np.zeros(n, dtype=np.float64)
    p = np.zeros(n, dtype=np.float64)
    innov = np.zeros(n, dtype=np.float64)
    x[0] = float(log_closes[0])
    p[0] = 1.0
    for t in range(1, n):
        x_pred = x[t - 1]
        p_pred = p[t - 1] + process_var
        z = float(log_closes[t])
        s = p_pred + obs_var
        k = p_pred / s if s > EPS else 0.0
        nu = z - x_pred
        innov[t] = nu
        x[t] = x_pred + k * nu
        p[t] = (1.0 - k) * p_pred
    innov[0] = 0.0
    return x, innov


def compute_microstructure(body: MicrostructureRequest) -> MicrostructureResponse:
    trades = body.trades
    cvd, buy_vol, sell_vol = _trades_cvd_buy_sell(trades)
    cvd_last = float(cvd[-1]) if cvd.size else 0.0
    cvd_slope = linear_slope(cvd) if cvd.size >= 2 else 0.0

    tot = buy_vol + sell_vol
    imbalance = (buy_vol - sell_vol) / tot if tot > EPS else None

    closes = np.array([float(c) for c in body.closes if np.isfinite(c) and c > 0], dtype=np.float64)
    entropy_ret: float | None = None
    entropy_ret_ratio: float | None = None
    entropy_vol: float | None = None
    kalman_level: float | None = None
    kalman_vel: float | None = None
    innov_std: float | None = None

    if closes.size >= 3:
        log_c = np.log(closes)
        lr = np.diff(log_c)
        entropy_ret, entropy_ret_ratio = shannon_entropy_normalized(lr, body.entropy_return_bins)

        xf, innov = kalman_log_price_1d(log_c, body.kalman_process_var, body.kalman_obs_var)
        if xf.size:
            kalman_level = float(math.exp(xf[-1]))
            if xf.size >= 2:
                kalman_vel = float(xf[-1] - xf[-2])
            ii = innov[1:]
            if ii.size >= 3:
                innov_std = float(np.std(ii))

    vols = np.array([float(v) for v in body.volumes if np.isfinite(v) and v >= 0], dtype=np.float64)
    if vols.size >= 5:
        lv = np.log(vols + 1.0)
        entropy_vol, _ = shannon_entropy_normalized(lv, min(12, body.entropy_return_bins))

    trade_count = len(trades)
    first_ms = trades[0].time if trades else None
    last_ms = trades[-1].time if trades else None

    noisy_entropy = (
        entropy_ret_ratio is not None and entropy_ret_ratio >= body.noise_entropy_ratio_threshold
    )
    noisy_innov = innov_std is not None and innov_std > 0.0025 and (entropy_ret_ratio or 0) > 0.75
    thin_trades = trade_count < 20
    noise_flag = bool(thin_trades or noisy_entropy or noisy_innov)

    meta = WindowMeta(
        trade_count=trade_count,
        first_trade_ms=first_ms,
        last_trade_ms=last_ms,
        close_count=int(closes.size),
    )

    raw = {
        "buy_aggressor_base_vol": buy_vol,
        "sell_aggressor_base_vol": sell_vol,
        "innovation_std": innov_std,
        "entropy_return_ratio": entropy_ret_ratio,
    }

    return MicrostructureResponse(
        cvd_last_n=cvd_last,
        cvd_slope=cvd_slope,
        order_flow_imbalance_approx=imbalance,
        entropy_returns=entropy_ret,
        entropy_volume_bins=entropy_vol,
        kalman_level=kalman_level,
        kalman_velocity=kalman_vel,
        noise_flag=noise_flag,
        window_meta=meta,
        raw=raw,
    )
