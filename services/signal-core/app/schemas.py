"""Pydantic request/response models for POST /v1/microstructure."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TradeTick(BaseModel):
    """One executed trade (Binance aggTrades shape after normalization)."""

    price: float = Field(gt=0, description="Execution price")
    qty: float = Field(ge=0, description="Base-asset quantity")
    is_buyer_maker: bool = Field(
        ...,
        description="Binance: True => buyer was maker => seller aggressor (hit bid)",
    )
    time: int = Field(..., description="Unix ms")


class MicrostructureRequest(BaseModel):
    trades: list[TradeTick] = Field(default_factory=list)
    closes: list[float] = Field(
        default_factory=list,
        description="Optional OHLC closes for return entropy / Kalman (oldest first)",
    )
    volumes: list[float] = Field(
        default_factory=list,
        description="Optional bar volumes for volume-bin entropy",
    )
    entropy_return_bins: int = Field(default=16, ge=4, le=64)
    noise_entropy_ratio_threshold: float = Field(
        default=0.88,
        ge=0.5,
        le=1.0,
        description="If H_returns / log2(bins) exceeds this, flag noisy regime",
    )
    kalman_process_var: float = Field(default=1e-8, gt=0)
    kalman_obs_var: float = Field(default=1e-5, gt=0)


class WindowMeta(BaseModel):
    trade_count: int
    first_trade_ms: int | None
    last_trade_ms: int | None
    close_count: int


class MicrostructureResponse(BaseModel):
    cvd_last_n: float
    cvd_slope: float
    order_flow_imbalance_approx: float | None
    entropy_returns: float | None
    entropy_volume_bins: float | None
    kalman_level: float | None
    kalman_velocity: float | None
    noise_flag: bool
    window_meta: WindowMeta
    raw: dict[str, Any] = Field(default_factory=dict)
