"""Unit tests: CVD sign convention and entropy."""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.metrics import (
    compute_cvd_series,
    compute_microstructure,
    shannon_entropy_discrete,
    signed_volume_from_trade,
)
from app.schemas import MicrostructureRequest, TradeTick


def test_signed_volume_buy_taker_positive() -> None:
    t = TradeTick(price=100.0, qty=1.0, is_buyer_maker=False, time=1)
    assert signed_volume_from_trade(t) == pytest.approx(1.0)


def test_signed_volume_sell_taker_negative() -> None:
    t = TradeTick(price=100.0, qty=2.0, is_buyer_maker=True, time=1)
    assert signed_volume_from_trade(t) == pytest.approx(-2.0)


def test_cvd_cumulative() -> None:
    trades = [
        TradeTick(price=1.0, qty=1.0, is_buyer_maker=False, time=1),
        TradeTick(price=1.0, qty=1.0, is_buyer_maker=True, time=2),
        TradeTick(price=1.0, qty=3.0, is_buyer_maker=False, time=3),
    ]
    s = compute_cvd_series(trades)
    assert s.tolist() == pytest.approx([1.0, 0.0, 3.0])


def test_entropy_uniform_high() -> None:
    rng = np.random.default_rng(42)
    u = rng.uniform(0, 1, size=5000)
    h = shannon_entropy_discrete(u, 16)
    assert h is not None
    # Uniform ~ log(16) nats
    assert h > math.log(16) * 0.85


def test_entropy_flatline_500_closes_is_exactly_zero() -> None:
    """500 identical prices => log-returns constant => H = 0.0 nats (no NaN)."""
    closes = [100.0] * 500
    body = MicrostructureRequest(trades=[], closes=closes)
    out = compute_microstructure(body)
    assert out.entropy_returns == pytest.approx(0.0, abs=0.0)
    assert out.entropy_returns == 0.0
    assert not (out.entropy_returns is not None and math.isnan(out.entropy_returns))


def test_maker_buy_negative_cvd_contribution() -> None:
    """Binance maker buy => seller aggressor => signed increment is -qty (proves negative CVD step)."""
    trades = [
        TradeTick(price=1.0, qty=2.5, is_buyer_maker=True, time=1),
    ]
    s = compute_cvd_series(trades)
    assert s[-1] == pytest.approx(-2.5)
    trades2 = [
        TradeTick(price=1.0, qty=1.0, is_buyer_maker=False, time=1),
        TradeTick(price=1.0, qty=3.0, is_buyer_maker=True, time=2),
    ]
    assert compute_cvd_series(trades2).tolist() == pytest.approx([1.0, -2.0])


def test_compute_microstructure_end_to_end() -> None:
    trades = [
        TradeTick(price=100.0, qty=1.0, is_buyer_maker=False, time=1000 + i) for i in range(30)
    ]
    closes = [100.0 + i * 0.01 for i in range(40)]
    body = MicrostructureRequest(trades=trades, closes=closes, volumes=[float(i + 1) for i in range(40)])
    out = compute_microstructure(body)
    assert out.cvd_last_n == pytest.approx(30.0)
    assert out.window_meta.trade_count == 30
    assert out.kalman_level is not None and out.kalman_level > 0
    assert out.entropy_returns is not None
