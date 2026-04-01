# Project Sovereign: Quant Data Ingestion Engine — Technical Blueprint

> **Classification:** Principal Architecture Document — v1.0  
> **Status:** Approved for Implementation  
> **Author:** Principal Quant Systems Architect  
> **Date:** 2026-04-01  
> **Scope:** Rust Microservice · ClickHouse Time-Series Store · IPC Bridge to Next.js AI Brain

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Integration Map](#2-system-integration-map)
3. [The Rust Microservice — Tech Stack](#3-the-rust-microservice--tech-stack)
4. [The Quant Logic — Order Book Imbalance & CVD](#4-the-quant-logic--order-book-imbalance--cvd)
5. [IPC Bridge — Rust to Next.js AI Brain](#5-ipc-bridge--rust-to-nextjs-ai-brain)
6. [ClickHouse Time-Series Schema](#6-clickhouse-time-series-schema)
7. [Infrastructure Requirements — Hetzner Bare Metal](#7-infrastructure-requirements--hetzner-bare-metal)
8. [Operational Playbook](#8-operational-playbook)
9. [Security Perimeter](#9-security-perimeter)
10. [Phased Rollout Roadmap](#10-phased-rollout-roadmap)

---

## 1. Executive Summary

The existing **QUANTUM MON CHERI** system operates a Node.js/TypeScript AI Brain that polls Binance REST endpoints every 20 minutes via BullMQ, feeds the data through a multi-LLM consensus engine (Gemini / Anthropic / Groq), and surfaces trading signals via a Next.js dashboard and Telegram.

**The Critical Gap:** REST polling at 20-minute cadence is strategically blind to the sub-second microstructure where institutional order flow is actually visible. Whale spoofing events last 2–15 seconds. CVD divergences build over 30–90 seconds. By the time the BullMQ cycle fires, these signals are gone — already exploited by HFT co-location engines.

**The Solution (Project Sovereign):** A standalone **Rust microservice** that maintains persistent, zero-drop WebSocket connections to Binance's raw L2 market data streams, applies deterministic quant logic at microsecond precision, persists every tick to **ClickHouse**, and injects **pre-computed, enriched alert objects** into the existing AI Brain via **Redis Pub/Sub** — the same Redis instance the system already runs.

The result: the AI Brain gains institutional-grade order book awareness without a single line of its TypeScript needing to manage WebSocket connections or raw tick parsing.

---

## 2. System Integration Map

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           BINANCE MARKET DATA INFRASTRUCTURE                        │
│                                                                                     │
│   wss://stream.binance.com:9443/stream?streams=                                     │
│   ├─ btcusdt@depth@100ms   (L2 Order Book delta, 100ms snapshots)                  │
│   ├─ ethusdt@depth@100ms                                                            │
│   ├─ <symbol>@depth@100ms  (for all active watchlist symbols)                      │
│   ├─ btcusdt@aggTrade       (aggregated trades for CVD)                             │
│   └─ <symbol>@aggTrade                                                              │
└──────────────────────────────┬──────────────────────────────────────────────────────┘
                               │ wss (TLS 1.3)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        RUST DATA INGESTION ENGINE (New)                             │
│                          [Hetzner AX102 Bare Metal]                                 │
│                                                                                     │
│  ┌─────────────────┐   ┌──────────────────────┐   ┌────────────────────────────┐   │
│  │  WebSocket Pool │──▶│  Order Book Engine   │──▶│  Quant Signal Processor   │   │
│  │  (tokio-tung-   │   │  (in-memory BTreeMap │   │  ├─ Spoofing Detector      │   │
│  │   stenite)      │   │   per symbol)        │   │  ├─ CVD Engine             │   │
│  │  Multi-stream   │   │  Full L2 rebuild     │   │  ├─ OBI Calculator         │   │
│  │  combined feed  │   │  from snapshots +    │   │  └─ TWAP Accumulation      │   │
│  └─────────────────┘   │  incremental deltas  │   │     Pattern Detector       │   │
│                        └──────────────────────┘   └────────────┬───────────────┘   │
│                                                                 │                   │
│                        ┌──────────────────────┐                │                   │
│                        │  ClickHouse Writer   │◀───────────────┘                   │
│                        │  (async batch insert │                │                   │
│                        │   every 50ms)        │                │                   │
│                        └──────────────────────┘                │                   │
│                                                                 ▼                   │
│                        ┌──────────────────────────────────────────────────────┐    │
│                        │  Redis Publisher (PUBLISH quant:alerts <JSON blob>) │    │
│                        │  Channel: quant:alerts                               │    │
│                        │  Channel: quant:orderbook:btcusdt  (top-5 L2 snap)  │    │
│                        └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────┘
                               │ Redis Pub/Sub (loopback or private LAN)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                     EXISTING NEXT.JS / TYPESCRIPT AI BRAIN                          │
│                       [quantum.moncherigroup.co.il]                                 │
│                                                                                     │
│  ┌──────────────────────┐   ┌───────────────────────┐   ┌────────────────────────┐ │
│  │  Redis Subscriber    │──▶│  Alert Enricher       │──▶│  Consensus Engine      │ │
│  │  (ioredis SUBSCRIBE  │   │  Injects Rust signal  │   │  (Gemini / Anthropic / │ │
│  │   quant:alerts)      │   │  into AI prompt as    │   │   Groq / Debate Room)  │ │
│  └──────────────────────┘   │  additional context   │   └────────────┬───────────┘ │
│                             └───────────────────────┘                │             │
│  ┌──────────────────────┐                                            ▼             │
│  │  BullMQ Queue Worker │   ┌───────────────────────────────────────────────────┐ │
│  │  (20-min cycle       │──▶│  PostgreSQL · Pinecone · Telegram · Dashboard    │ │
│  │   unchanged)         │   └───────────────────────────────────────────────────┘ │
│  └──────────────────────┘                                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
                               │ HTTP (internal network)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLICKHOUSE (Co-located)                                │
│                        Tick storage · Historical replay                             │
│  Tables: l2_ticks · agg_trades · spoof_events · cvd_snapshots                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Rust Microservice — Tech Stack

### 3.1 Language Rationale

Rust is the only systems language that simultaneously guarantees:

| Property | Why It Matters Here |
|---|---|
| **Zero GC pauses** | A 50ms GC pause on a JVM/Go service means missing an entire order book update cycle. Rust has no GC. |
| **Deterministic memory layout** | Order book BTreeMaps live in contiguous memory with no pointer indirection overhead. |
| **Zero-cost async** | `tokio`'s async/await compiles to state machines with no heap allocation per poll. |
| **Memory safety without runtime cost** | The borrow checker eliminates data races and use-after-free at compile time. No runtime bounds checks beyond slice indexing. |
| **`#[repr(C)]` structs for ClickHouse native protocol** | Raw binary encoding of tick structs maps directly to ClickHouse's native binary format — no serialization overhead. |

### 3.2 Crate Dependency Manifest (`Cargo.toml`)

```toml
[package]
name    = "quant-ingestion-engine"
version = "0.1.0"
edition = "2021"

[profile.release]
opt-level     = 3
lto           = "fat"          # Link-Time Optimization: whole-crate inlining
codegen-units = 1              # Single codegen unit for maximum optimization
panic         = "abort"        # No unwinding overhead; hard crash on panic
strip         = "symbols"      # Smaller binary for deployment

[dependencies]

# ── Async Runtime ──────────────────────────────────────────────────────────────
tokio            = { version = "1", features = ["full"] }
# "full" enables: rt-multi-thread, net, time, sync, io-util, macros, signal
# The multi-thread scheduler maps to physical CPU cores via work-stealing.

# ── WebSocket Client ───────────────────────────────────────────────────────────
tokio-tungstenite = { version = "0.21", features = ["native-tls"] }
# native-tls links to the OS TLS stack (OpenSSL on Linux) for TLS 1.3.
# This avoids the ~2ms overhead of rustls certificate chain validation on
# every reconnect. Hardware AES-NI instruction set is used automatically.

# ── HTTP Client (REST fallback for L2 snapshot seeding) ───────────────────────
reqwest          = { version = "0.12", features = ["json", "gzip"] }

# ── JSON (WebSocket message parsing) ──────────────────────────────────────────
serde            = { version = "1", features = ["derive"] }
serde_json       = "1"
# simd-json is NOT used here deliberately: the Binance order book delta
# payloads are small (<4KB). simd-json's advantage only manifests at >16KB.
# serde_json avoids the SIMD alignment requirements that would complicate
# zero-copy buffer management.

# ── Redis IPC ─────────────────────────────────────────────────────────────────
redis            = { version = "0.25", features = ["tokio-comp", "connection-manager"] }
# connection-manager provides automatic reconnect with exponential backoff.
# tokio-comp is the async interface. Uses RESP3 protocol for inline type info.

# ── ClickHouse Writer ─────────────────────────────────────────────────────────
clickhouse       = { version = "0.12", features = ["watch"] }
# Uses ClickHouse's native HTTP interface (not the binary TCP protocol) for
# simplicity and firewall compatibility. Batch inserts via INSERT ... VALUES.
# The `watch` feature enables LIVE VIEW queries for streaming aggregations.

# ── Ordered Map (Order Book) ──────────────────────────────────────────────────
# std::collections::BTreeMap<OrderedFloat<f64>, f64> is used directly.
# BTreeMap maintains price levels in sorted order (ascending) with O(log n)
# insert/delete. For a typical order book with ~500 active price levels,
# log₂(500) ≈ 9 comparisons per operation — negligible.
ordered-float    = "4"         # NaN-safe f64 wrapper for BTreeMap keys

# ── Time / Timestamps ─────────────────────────────────────────────────────────
chrono           = { version = "0.4", features = ["serde"] }

# ── Metrics / Observability ───────────────────────────────────────────────────
prometheus       = "0.13"      # /metrics endpoint for Grafana scraping
tracing          = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }

# ── Config ────────────────────────────────────────────────────────────────────
config           = "0.14"      # Layered config: config.toml + env var overrides
dotenv           = "0.15"

# ── Graceful Shutdown ─────────────────────────────────────────────────────────
tokio-graceful-shutdown = "0.15"
```

### 3.3 Runtime Architecture

The engine runs as a single OS process with the following `tokio` task topology:

```
OS Process: quant-ingestion-engine
│
├─ tokio::main  [multi_thread, worker_threads = (N_CPU - 2)]
│
├─ Task: ws_supervisor                (1 task per symbol group)
│  └─ Manages combined Binance stream: reconnect loop, heartbeat pong
│
├─ Task: orderbook_processor          (1 task per symbol)
│  └─ Receives depth deltas via mpsc channel
│  └─ Maintains BTreeMap<OrderedFloat<f64>, f64> bid/ask sides
│  └─ Detects spoofing events, computes OBI
│  └─ Sends signals to signal_bus via broadcast channel
│
├─ Task: cvd_engine                   (1 task per symbol)
│  └─ Receives aggTrade events via mpsc channel
│  └─ Accumulates CVD in a ring buffer (last 1000 ticks)
│  └─ Detects TWAP accumulation patterns
│  └─ Sends CVD alerts to signal_bus
│
├─ Task: signal_bus                   (global broadcast)
│  └─ Receives from all orderbook_processor + cvd_engine tasks
│  └─ Deduplicates signals within 500ms window
│  └─ Serializes to JSON and PUBLISH to Redis
│
├─ Task: clickhouse_writer            (global singleton)
│  └─ Receives raw ticks from all processors via mpsc channel
│  └─ Batches 1000 rows or 50ms, whichever comes first
│  └─ Executes INSERT INTO l2_ticks ... (async HTTP POST)
│
└─ Task: metrics_server               (Prometheus HTTP on :9090)
   └─ Exposes: ws_reconnects, ticks_processed, alerts_published,
               clickhouse_write_latency_ms, redis_publish_latency_ms
```

**Inter-task channel types:**
- `tokio::sync::mpsc` — for unicast tick flow (WebSocket → processor)
- `tokio::sync::broadcast` — for signal fan-out (processor → multiple consumers)
- `tokio::sync::watch` — for shared state (e.g., current order book snapshot for Redis publishing)

**Channel buffer sizing:**
- Depth delta mpsc: `capacity = 10_000` (100ms × ~100 updates/ms at peak)
- aggTrade mpsc: `capacity = 50_000` (burst capacity during volatile periods)
- Signal broadcast: `capacity = 256` (alerts are low-frequency, high-value)

---

## 4. The Quant Logic — Order Book Imbalance & CVD

### 4.1 L2 Order Book Construction Protocol

Binance's `<symbol>@depth@100ms` stream delivers **incremental deltas**, not full snapshots. The engine must implement Binance's documented **order book management procedure** exactly:

**Phase 1: Initial Snapshot Seeding**

1. Subscribe to `wss://stream.binance.com:9443/ws/btcusdt@depth` to begin buffering updates.
2. Fetch the REST snapshot: `GET https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=1000`.
3. The snapshot contains a `lastUpdateId` field.
4. Discard all buffered WebSocket events where `event.u` (final update ID) < `lastUpdateId + 1`.
5. Apply the first event where `event.U` ≤ `lastUpdateId + 1` AND `event.u` ≥ `lastUpdateId + 1`.
6. Continue applying subsequent events in sequence, verifying `event.U == prev_event.u + 1`.

If any event arrives out of sequence, the engine drops the local book and re-seeds from REST. This is handled by the `orderbook_processor` task's state machine:

```
State Machine: OrderBookState
├─ Seeding      → awaiting REST snapshot + buffering WS events
├─ Syncing      → applying first valid delta after snapshot
├─ Live         → normal operation, full L2 available
└─ Resyncing    → gap detected, re-fetching REST snapshot
```

**Phase 2: Delta Application**

For each incoming delta event, the engine iterates over the bid and ask arrays:

```
For each (price, quantity) pair in bids_delta:
  if quantity == 0.0:
    book.bids.remove(price)   // Price level fully cancelled
  else:
    book.bids.insert(price, quantity)  // New or updated level

For each (price, quantity) pair in asks_delta:
  if quantity == 0.0:
    book.asks.remove(price)
  else:
    book.asks.insert(price, quantity)
```

The BTreeMap's natural sort order means `book.bids.iter().next_back()` always returns the best bid in O(log n). There is **no manual sorting**; the data structure enforces order invariants.

### 4.2 Order Book Imbalance (OBI) — Real-Time Calculation

OBI quantifies buying vs. selling pressure by comparing the total notional value (price × quantity) at the top N levels of the bid and ask sides.

**Formula:**

```
OBI = (Σ bid_qty_i × bid_price_i) / (Σ bid_qty_i × bid_price_i + Σ ask_qty_i × ask_price_i)

Where i ∈ [1, N], N = configurable depth (default: 20 levels)
```

**Interpretation thresholds (tunable via config.toml):**

| OBI Value | Signal |
|---|---|
| > 0.70 | Strong buy-side pressure — potential breakout fuel |
| 0.55 – 0.70 | Mild buy-side imbalance |
| 0.45 – 0.55 | Balanced — no directional bias |
| 0.30 – 0.45 | Mild sell-side imbalance |
| < 0.30 | Strong sell-side pressure — potential dump fuel |

OBI is computed after every 100ms depth event and emitted to the signal bus if it crosses a threshold boundary (edge-triggered, not level-triggered, to avoid alert flooding).

### 4.3 Whale Spoofing Detection

**Definition:** A "spoofing" event occurs when a large limit order (a "whale wall") is placed at a key price level, temporarily distorting OBI to manipulate market participants, then cancelled within seconds before execution.

**Detection Algorithm:**

The engine maintains a **shadow order book** that tracks the age and size history of each price level.

```
Data Structure per price level:
  PriceLevelMeta {
    price:          f64,
    quantity:       f64,
    first_seen_ms:  i64,    // epoch ms when this qty first appeared
    max_qty_seen:   f64,    // peak quantity at this level in its lifetime
    updates:        u32,    // number of delta updates applied
  }
```

**Spoofing Trigger Conditions (ALL must be true):**

1. **Wall Placement:** A new price level appears OR an existing level's quantity increases by ≥ `SPOOF_MIN_WALL_NOTIONAL_USD` (default: $500,000 notional). Notional = price × quantity.

2. **OBI Distortion:** The new wall causes OBI to shift by ≥ `SPOOF_OBI_DELTA_THRESHOLD` (default: 0.12) within one 100ms window.

3. **Proximity to Market:** The wall is placed within `SPOOF_MAX_DISTANCE_BPS` basis points of the mid-price (default: 50 bps = 0.5%). Walls placed far off-market are irrelevant.

4. **Cancellation Speed:** The level's quantity drops by ≥ 80% within `SPOOF_MAX_LIFETIME_MS` milliseconds (default: 15,000 ms / 15 seconds) of its peak appearance.

5. **No Fill Confirmation:** The price level never traded through (verified by checking aggTrade stream — if no trades were recorded at that price during the wall's lifetime, it was never filled).

**Emitted Alert Payload (JSON, published to Redis `quant:alerts`):**

```json
{
  "alert_type": "WHALE_SPOOF",
  "symbol": "BTCUSDT",
  "timestamp_ms": 1743513600000,
  "direction": "BID",
  "wall_price": 83450.00,
  "wall_peak_notional_usd": 2340000.00,
  "wall_lifetime_ms": 4200,
  "obi_before": 0.48,
  "obi_during": 0.72,
  "obi_after": 0.46,
  "mid_price_at_event": 83490.00,
  "distance_from_mid_bps": 48.0,
  "confidence": 0.91,
  "interpretation": "Large bid wall of $2.34M placed 48bps below mid, held 4.2s then pulled without fills. Classic spoofing to attract retail buyers before dump."
}
```

### 4.4 Stealth Accumulation via CVD (Cumulative Volume Delta)

**Definition:** CVD measures the net difference between buy-initiated and sell-initiated volume. Stealth accumulation occurs when a large player uses **TWAP (Time-Weighted Average Price) execution** to split large buys into many small orders across time, preventing visible market impact while accumulating a position.

**CVD Computation:**

The engine processes every event from the `<symbol>@aggTrade` stream. Each aggTrade event contains:
- `p`: price (string, parsed to f64)
- `q`: quantity
- `m`: `true` if the buyer is the market maker (i.e., the aggressor is a SELLER), `false` if the aggressor is a BUYER

```
For each aggTrade event:
  volume_delta = if event.m == false { +event.q } else { -event.q }
  cvd += volume_delta

Ring buffer: last 1000 trade events, with timestamps
Snapshot interval: CVD value captured every 10 seconds into ClickHouse
```

**TWAP Accumulation Pattern Detector:**

The engine maintains a sliding window of CVD measurements (lookback: configurable, default 300 seconds / 5 minutes). A **stealth accumulation alert** fires when:

1. **Consistent CVD Drift:** CVD increases monotonically (or near-monotonically, allowing ≤15% retracement) over the full window. This means buy volume is persistently outpacing sell volume.

2. **Price Suppression:** Despite positive CVD drift, price moves less than `ACCUM_MAX_PRICE_MOVE_PCT` (default: 0.3%) during the window. This indicates the buyer is absorbing ask-side liquidity without pushing price — characteristic of TWAP execution.

3. **Minimum CVD Magnitude:** The total CVD change during the window exceeds `ACCUM_MIN_CVD_USD` (default: $1,000,000 notional equivalent). Calculated as: `Σ |volume_delta_i × price_i|`.

4. **Order Size Distribution:** Individual trade sizes follow a near-uniform distribution (TWAP signature) rather than the heavy-tailed distribution of organic retail flow. Kolmogorov-Smirnov test statistic < 0.15 versus a uniform distribution.

**Emitted Alert Payload:**

```json
{
  "alert_type": "STEALTH_ACCUMULATION",
  "symbol": "ETHUSDT",
  "timestamp_ms": 1743513600000,
  "window_seconds": 300,
  "cvd_start": -12400.5,
  "cvd_end": 8900.2,
  "cvd_delta": 21300.7,
  "cvd_delta_notional_usd": 3890000.00,
  "price_start": 1820.40,
  "price_end": 1821.10,
  "price_change_pct": 0.038,
  "trade_count": 847,
  "avg_trade_size_usd": 4593.00,
  "ks_statistic": 0.09,
  "confidence": 0.87,
  "interpretation": "847 trades over 5min drove $3.89M net buy volume but only moved price 0.04%. Uniform trade size distribution (KS=0.09) confirms TWAP bot. Stealth accumulation pattern. Price likely to move sharply once position is complete."
}
```

### 4.5 Signal Deduplication & Confidence Scoring

The `signal_bus` task applies deduplication before publishing to Redis:

- **Spoofing:** Two spoof events for the same symbol + direction are deduplicated if they occur within 5 seconds of each other.
- **Accumulation:** Two accumulation alerts for the same symbol are deduplicated if they share >60% of their time window.

**Confidence Score Components:**

| Component | Weight | Description |
|---|---|---|
| Wall notional vs. 30-day average wall size | 30% | Larger-than-normal walls are more significant |
| OBI distortion magnitude | 25% | Larger delta = stronger signal |
| Lifetime of wall (inverted) | 20% | Shorter lifetime = cleaner spoof signal |
| Historical false positive rate for symbol | 25% | Per-symbol calibration from ClickHouse historical data |

---

## 5. IPC Bridge — Rust to Next.js AI Brain

### 5.1 Transport: Redis Pub/Sub

**Rationale for Redis Pub/Sub (over gRPC):**

| Criterion | Redis Pub/Sub | gRPC |
|---|---|---|
| **Existing infra** | Already running at `redis://127.0.0.1:6379` | Requires new service, protobuf compilation |
| **Latency** | ~50µs loopback | ~200µs + HTTP/2 framing |
| **Consumer coupling** | Zero — any number of subscribers, fire-and-forget | Point-to-point or requires broker |
| **TypeScript client** | `ioredis` — already installed | `@grpc/grpc-js` — new dep |
| **Schema evolution** | JSON — backward compatible | Requires .proto version management |
| **Backpressure** | None (pub/sub is lossy) | Flow control built-in |

**Decision:** Redis Pub/Sub is the correct choice for this use case. Alert volume is low (typically 0–10 alerts per minute per symbol). The lossy nature of Pub/Sub is acceptable because each alert is a stateless notification — if one is missed, the next alert will carry updated information. High-frequency tick data is NOT published to Redis; it goes directly to ClickHouse.

### 5.2 Redis Channel Topology

```
quant:alerts                → High-value alerts (WHALE_SPOOF, STEALTH_ACCUMULATION)
quant:orderbook:<symbol>    → Top-5 bid/ask snapshot, published every 1 second
quant:cvd:<symbol>          → Current CVD value + 60s trend, published every 10 seconds
quant:heartbeat             → Engine liveness pulse, published every 5 seconds
```

### 5.3 Next.js Integration (TypeScript)

The existing `lib/queue/queue-worker.ts` and the AI Brain pipeline need a **Redis Subscriber** module added. This module runs as a separate long-lived listener alongside the BullMQ worker and **injects alert context into the next BullMQ scan cycle** for the affected symbol.

**New module to create:** `lib/quant-bridge/rust-signal-subscriber.ts`

Conceptual behavior:
1. Subscribe to `quant:alerts` using `ioredis` (already installed).
2. On receiving an alert, parse the JSON payload.
3. Write the alert into a **PostgreSQL staging table** (`quant_alerts_staging`) with a `consumed: false` flag and TTL of 30 minutes.
4. When `doAnalysisCore()` runs for a symbol, it queries `quant_alerts_staging` for any unconsumed alerts for that symbol within the last 30 minutes.
5. If alerts exist, they are appended to the AI prompt as a new `order_book_microstructure` context block.
6. After consumption, the alert is marked `consumed: true`.

**AI Prompt Injection Format:**

```
=== REAL-TIME ORDER BOOK MICROSTRUCTURE (Rust Engine) ===
[WHALE SPOOF DETECTED — 4.2 seconds ago]
A $2.34M bid wall was placed at $83,450 (48bps below mid), held for 4.2 seconds, 
then pulled with zero fills. OBI jumped from 0.48 to 0.72 during the event.
Classic spoofing to attract retail buyers. Interpret as BEARISH signal.
Confidence: 91%

[STEALTH ACCUMULATION — 5min window]  
$3.89M net buy volume absorbed over 300 seconds with only 0.04% price move.
TWAP signature detected (KS=0.09). Entity is accumulating ETH without price impact.
Interpret as BULLISH signal with delayed price target activation.
Confidence: 87%
=== END MICROSTRUCTURE ===
```

This format is designed for zero-friction injection into the existing prompt engineering pipeline in `lib/alpha-engine.ts`.

---

## 6. ClickHouse Time-Series Schema

### 6.1 Engine Selection Rationale

ClickHouse is the correct database for this workload:

| Requirement | ClickHouse | PostgreSQL (existing) | TimescaleDB |
|---|---|---|---|
| **Insert throughput** | 1M rows/sec (single node) | ~50K rows/sec | ~200K rows/sec |
| **Columnar compression** | 10–40x ratio on tick data | Row-based, 2–4x | Columnar chunks, 10–20x |
| **Time-range queries** | Partition pruning + PREWHERE | Sequential scan | Chunk pruning |
| **Aggregation speed** | Vectorized SIMD operations | Hash aggregation | TimescaleDB continuous aggs |
| **ORDER BY key** | Primary key = physical sort order | BRIN indexes | BRIN + chunk sort |
| **Operational simplicity** | Single binary, no extensions | Already running | Requires extension install |

**Verdict:** PostgreSQL cannot sustain millions of L2 ticks per day without severe I/O saturation. ClickHouse is purpose-built for this exact workload.

### 6.2 Table Definitions

```sql
-- Raw L2 order book tick: one row per price level per depth event
CREATE TABLE l2_ticks
(
    ts          DateTime64(3, 'UTC'),  -- millisecond precision
    symbol      LowCardinality(String),
    side        Enum8('bid' = 1, 'ask' = 2),
    price       Float64,
    quantity    Float64,              -- 0.0 = level removed
    event_id    UInt64,               -- Binance lastUpdateId
    update_seq  UInt32                -- position within delta batch
)
ENGINE = MergeTree
PARTITION BY (toYYYYMMDD(ts), symbol)
ORDER BY (symbol, side, ts, price)
TTL ts + INTERVAL 30 DAY             -- auto-expire ticks after 30 days
SETTINGS index_granularity = 8192;

-- Aggregated trades (for CVD)
CREATE TABLE agg_trades
(
    ts           DateTime64(3, 'UTC'),
    symbol       LowCardinality(String),
    price        Float64,
    quantity     Float64,
    is_buyer_mm  Bool,               -- true = seller is aggressor
    trade_id     UInt64
)
ENGINE = MergeTree
PARTITION BY (toYYYYMMDD(ts), symbol)
ORDER BY (symbol, ts, trade_id)
TTL ts + INTERVAL 90 DAY;           -- trades retained 90 days for pattern replay

-- CVD snapshots (10-second intervals, persisted for trend analysis)
CREATE TABLE cvd_snapshots
(
    ts              DateTime64(3, 'UTC'),
    symbol          LowCardinality(String),
    cvd_value       Float64,          -- cumulative value at snapshot time
    cvd_delta_10s   Float64,          -- change from previous snapshot
    price           Float64,
    mid_price       Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (symbol, ts)
TTL ts + INTERVAL 180 DAY;

-- Detected spoof events (permanent retention — training data)
CREATE TABLE spoof_events
(
    ts                     DateTime64(3, 'UTC'),
    symbol                 LowCardinality(String),
    direction              Enum8('bid' = 1, 'ask' = 2),
    wall_price             Float64,
    wall_peak_notional_usd Float64,
    wall_lifetime_ms       UInt32,
    obi_before             Float32,
    obi_during             Float32,
    obi_after              Float32,
    mid_price_at_event     Float64,
    distance_from_mid_bps  Float32,
    confidence             Float32,
    was_followed_by_move   Nullable(Bool),   -- back-filled by outcome tracker
    price_move_pct_1h      Nullable(Float32) -- back-filled 1 hour later
)
ENGINE = MergeTree
ORDER BY (symbol, ts);

-- Materialized view: OBI 1-minute OHLC (pre-aggregated for dashboard queries)
CREATE MATERIALIZED VIEW obi_1min_mv
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMMDD(ts_bucket)
ORDER BY (symbol, ts_bucket)
AS SELECT
    toStartOfMinute(ts)              AS ts_bucket,
    symbol,
    avgState(obi)                    AS obi_avg,
    minState(obi)                    AS obi_min,
    maxState(obi)                    AS obi_max,
    countState()                     AS tick_count
FROM l2_ticks
-- OBI must be computed from l2_ticks before this MV; 
-- in practice, pre-compute OBI in Rust and insert into a separate obi_ticks table
GROUP BY ts_bucket, symbol;
```

### 6.3 ClickHouse Write Strategy

The Rust engine uses **batched HTTP inserts**:
- Accumulate rows in a `Vec<TickRow>` per table.
- Flush trigger: 1000 rows OR 50ms elapsed, whichever comes first.
- On flush: serialize to JSON (ClickHouse's JSONEachRow format) and POST to `http://localhost:8123/?query=INSERT INTO l2_ticks FORMAT JSONEachRow`.
- On failure: exponential backoff (100ms, 200ms, 400ms, 800ms), then dead-letter to a local file buffer (`/var/lib/quant-engine/dlq/`) to prevent data loss on transient ClickHouse downtime.

**Expected throughput:**
- BTCUSDT alone generates ~500 depth delta updates per second at peak.
- Each delta typically contains 5–20 price level changes.
- Peak insert rate: ~10,000 rows/second per symbol.
- With 20 symbols: ~200,000 rows/second — well within ClickHouse's 1M rows/sec capacity on the specified hardware.

---

## 7. Infrastructure Requirements — Hetzner Bare Metal

### 7.1 Server Selection: Hetzner AX102

**Model:** [Hetzner AX102](https://www.hetzner.com/dedicated-rootserver/ax102)

| Specification | Details | Rationale |
|---|---|---|
| **CPU** | AMD EPYC 9454P (48 cores / 96 threads, 3.65GHz base, 3.80GHz boost) | Rust tokio worker threads = 46 (2 reserved for OS/IRQ). EPYC's large L3 cache (256MB) keeps the order book BTreeMaps hot. |
| **RAM** | 192GB DDR5 ECC (6-channel) | ClickHouse operates most efficiently when the working set fits in RAM. 20 symbols × 30 days × ~5GB compressed = ~100GB; 192GB provides comfortable headroom for OS page cache. |
| **Storage** | 2× 1.92TB NVMe SSD (RAID-1 via mdadm) | NVMe sequential write: ~3.5GB/s — eliminates I/O bottleneck for ClickHouse WAL. RAID-1 for tick data durability. |
| **Network** | 1Gbit/s dedicated uplink (unmetered) | Binance WebSocket stream bandwidth: ~10Mbps per symbol at peak. 20 symbols = ~200Mbps. 1Gbit uplink provides 5× headroom. |
| **Location** | Hetzner FSN1 (Falkenstein, Germany) | ~15ms RTT to Binance API servers in Frankfurt. Lower latency than US datacenters for EU-based Binance endpoints. |
| **OS** | Debian 12 (Bookworm) | LTS kernel, stable `io_uring` support, minimal attack surface. |
| **Price** | ~€189/month | |

### 7.2 Process Layout on the AX102

```
┌─ AX102 (Debian 12) ──────────────────────────────────────────────────────┐
│                                                                           │
│  CPU Pinning (via taskset / systemd CPUAffinity):                        │
│  ├─ Cores 0–43:  quant-ingestion-engine (Rust, tokio multi-thread)       │
│  ├─ Cores 44–45: ClickHouse server                                        │
│  ├─ Cores 46–47: OS, network IRQ, system daemons                         │
│                                                                           │
│  Memory Allocation:                                                       │
│  ├─ 64GB:  ClickHouse mark_cache + uncompressed_cache                    │
│  ├─ 96GB:  OS page cache (ClickHouse NVMe read cache)                    │
│  ├─ 16GB:  Rust process heap (order books, signal buffers)               │
│  └─ 16GB:  Redis (if co-located) + system                                │
│                                                                           │
│  Storage Layout (NVMe RAID-1):                                           │
│  ├─ /var/lib/clickhouse/   (ClickHouse data directory)                   │
│  ├─ /var/lib/quant-engine/ (engine state, DLQ buffers)                   │
│  └─ /var/log/quant/        (structured JSON logs)                        │
│                                                                           │
│  Network:                                                                 │
│  ├─ Public IP: Binance WebSocket connections (outbound)                  │
│  └─ Private IP / Hetzner VLAN: Redis communication to existing VPS       │
│                                                                           │
│  Processes (systemd services):                                           │
│  ├─ quant-engine.service   (Rust binary, auto-restart on failure)        │
│  ├─ clickhouse-server      (ClickHouse, binds to 127.0.0.1:8123)        │
│  └─ node-exporter          (Prometheus hardware metrics)                 │
└───────────────────────────────────────────────────────────────────────────┘
```

### 7.3 ClickHouse Configuration Tuning (`/etc/clickhouse-server/config.xml`)

Key parameters to override from defaults:

```xml
<!-- Memory: allow ClickHouse to use up to 80% of RAM for query execution -->
<max_memory_usage>154618822656</max_memory_usage>  <!-- 144GB -->

<!-- Mark cache: keep compressed block indexes in RAM -->
<mark_cache_size>34359738368</mark_cache_size>       <!-- 32GB -->

<!-- Uncompressed cache: hot decompressed blocks -->
<uncompressed_cache_size>17179869184</uncompressed_cache_size>  <!-- 16GB -->

<!-- Background merges: allow 8 concurrent merge threads -->
<background_pool_size>8</background_pool_size>
<background_merges_mutations_concurrency_ratio>2</background_merges_mutations_concurrency_ratio>

<!-- Disable swap: never allow swap for ClickHouse (ECC RAM is sufficient) -->
<max_bytes_before_external_group_by>0</max_bytes_before_external_group_by>

<!-- Network: only bind to loopback (Rust engine on same host) -->
<listen_host>127.0.0.1</listen_host>
<tcp_port>9000</tcp_port>
<http_port>8123</http_port>
```

### 7.4 Linux Kernel Tuning (`/etc/sysctl.d/99-quant-engine.conf`)

```bash
# Increase socket buffer sizes for high-throughput WebSocket connections
net.core.rmem_max = 134217728       # 128MB receive buffer
net.core.wmem_max = 134217728       # 128MB send buffer
net.ipv4.tcp_rmem = 4096 65536 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

# Reduce TCP retransmission timeout (faster reconnect on Binance WS drops)
net.ipv4.tcp_syn_retries = 2
net.ipv4.tcp_retries2 = 5

# Disable transparent huge pages (causes latency spikes in memory-intensive apps)
# (set via /sys/kernel/mm/transparent_hugepage/enabled = never)

# Increase file descriptor limit (many open WS connections)
fs.file-max = 1000000

# io_uring for async I/O (tokio uses this automatically on Linux 5.1+)
kernel.io_uring_disabled = 0
```

---

## 8. Operational Playbook

### 8.1 Deployment Pipeline

```
1. git push → GitHub Actions workflow triggers
2. cargo build --release --target x86_64-unknown-linux-gnu
   (cross-compiled on CI runner, binary uploaded as release artifact)
3. scp quant-ingestion-engine hetzner-ax102:/opt/quant-engine/
4. systemctl restart quant-engine.service
5. Health check: curl http://localhost:9090/metrics | grep quant_engine_up
6. Verify Redis: redis-cli SUBSCRIBE quant:heartbeat (expect pulse within 5s)
```

### 8.2 Monitoring & Alerting

**Prometheus metrics exposed by the Rust engine:**

```
quant_engine_up                          # 1 = healthy, 0 = degraded
quant_ws_connections_active              # WebSocket connections open
quant_ws_reconnects_total                # Counter: reconnection events
quant_ticks_processed_total             # Counter: depth events processed
quant_orderbook_state{symbol, state}    # Gauge: Live/Seeding/Resyncing
quant_alerts_published_total            # Counter: signals sent to Redis
quant_clickhouse_write_latency_ms       # Histogram: insert batch latency
quant_clickhouse_errors_total           # Counter: failed batches
quant_redis_publish_latency_us          # Histogram: PUBLISH latency (microseconds)
quant_spoof_events_detected_total       # Counter: whale spoof events
quant_accumulation_events_total         # Counter: TWAP accumulation events
```

**Grafana Dashboard panels:**
- WebSocket connection health timeline
- Ticks/sec per symbol (stacked area chart)
- OBI heatmap across symbols (real-time)
- Alert rate over time
- ClickHouse write latency P50/P95/P99

**PagerDuty / Telegram alert rules:**
- `quant_engine_up == 0` for > 30s → CRITICAL
- `quant_ws_reconnects_total` rate > 3/min → WARNING
- `quant_clickhouse_errors_total` rate > 0 → WARNING (DLQ accumulating)
- Any symbol `orderbook_state != Live` for > 60s → WARNING

### 8.3 Binance Rate Limit Management

The Binance WebSocket API enforces:
- Maximum 300 streams per connection (using the combined stream endpoint)
- Maximum 5 WebSocket connections per IP per minute (new connection rate limit)
- Ping/pong: server sends ping every 3 minutes; client must respond within 10 minutes or connection is dropped

The engine's `ws_supervisor` task handles:
- **Pong responses:** Automatically replies to server pings (handled by `tokio-tungstenite`)
- **Subscription batching:** Groups all symbol streams into combined streams: `wss://stream.binance.com:9443/stream?streams=btcusdt@depth@100ms/ethusdt@depth@100ms/...`
- **Reconnect strategy:** Exponential backoff starting at 1s, max 60s, with jitter (`delay = min(60, 2^n) * rand(0.8, 1.2)`)

---

## 9. Security Perimeter

### 9.1 Network Isolation

```
Hetzner Firewall Rules (applied at Hetzner Robot panel):
INBOUND:
  ├─ Port 22 (SSH):    Allow from admin IP only (static)
  ├─ Port 9090 (Prom): Allow from monitoring VPS only
  └─ ALL ELSE:         DENY

OUTBOUND:
  ├─ Port 443 (HTTPS): Allow to Binance IP ranges (WebSocket upgrade)
  ├─ Port 6379 (Redis): Allow to existing VPS private IP
  └─ ALL ELSE:         DENY (default)
```

### 9.2 ClickHouse Access Control

ClickHouse binds only to `127.0.0.1`. No remote access. The Rust engine communicates via localhost HTTP. Read access for historical queries is routed through a dedicated read-only ClickHouse user:

```sql
CREATE USER quant_reader IDENTIFIED BY 'strong_read_password';
GRANT SELECT ON quant_db.* TO quant_reader;
-- NO INSERT, UPDATE, DELETE, ALTER permissions
```

### 9.3 Rust Binary Hardening

The compiled release binary is hardened at build time:

```bash
# RELRO (Relocation Read-Only): prevents GOT overwrite attacks
RUSTFLAGS="-C link-arg=-Wl,-z,relro,-z,now"

# Stack canaries: enabled by default in Rust on Linux
# Position Independent Executable: enabled by default in Rust
# No debug symbols in production binary (strip = "symbols" in Cargo.toml)
```

---

## 10. Phased Rollout Roadmap

### Phase 1: Foundation (Week 1–2)
- [ ] Provision Hetzner AX102, install Debian 12
- [ ] Install ClickHouse, create schema, verify insert performance
- [ ] Implement WebSocket pool + order book reconstruction (BTreeMap engine)
- [ ] Implement ClickHouse batch writer
- [ ] Unit tests: order book sync state machine, delta application correctness

### Phase 2: Quant Logic (Week 3–4)
- [ ] Implement OBI calculator + threshold-triggered emission
- [ ] Implement spoofing detector (shadow order book + lifetime tracker)
- [ ] Implement CVD engine + TWAP accumulation detector
- [ ] Integration test: replay recorded Binance stream, verify signal quality

### Phase 3: IPC Bridge (Week 5)
- [ ] Implement Redis publisher (signal bus → `quant:alerts`)
- [ ] Add `lib/quant-bridge/rust-signal-subscriber.ts` to Next.js AI Brain
- [ ] Add `quant_alerts_staging` PostgreSQL table
- [ ] Inject Rust signals into `doAnalysisCore()` prompt context

### Phase 4: Observability & Hardening (Week 6)
- [ ] Deploy Prometheus + Grafana on monitoring VPS
- [ ] Configure Telegram alerts for all critical metrics
- [ ] Load test: simulate 1 week of peak Binance tick volume
- [ ] Back-test: verify spoof detector against known historical spoof events (Jan 2026 BTC crash)
- [ ] Go live: enable `SIGNAL_CORE_ENABLED=1` in `.env`

### Phase 5: Model Feedback Loop (Week 7–8)
- [ ] ClickHouse outcome tracker: back-fill `spoof_events.was_followed_by_move` hourly
- [ ] Tune detection thresholds based on precision/recall from Phase 4 back-test
- [ ] Expose ClickHouse read endpoint to AI Brain for historical microstructure queries
- [ ] Add CVD trend to Telegram signal messages

---

## Appendix A: Key Configuration Parameters (`config.toml`)

```toml
[engine]
symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "ADAUSDT",
           "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT"]
orderbook_depth_levels = 20        # Levels used for OBI calculation
depth_stream_interval_ms = 100     # Binance @depth@100ms
aggtrade_buffer_size = 50_000      # Ring buffer capacity

[spoofing]
min_wall_notional_usd = 500_000    # Minimum wall size to track
obi_delta_threshold = 0.12         # Minimum OBI shift to trigger
max_distance_bps = 50              # Max distance from mid-price (basis points)
max_lifetime_ms = 15_000           # Maximum time before cancellation (ms)
min_cancellation_pct = 0.80        # Min % of quantity cancelled to confirm spoof

[cvd]
lookback_seconds = 300             # CVD analysis window
max_price_move_pct = 0.30          # Max price move during accumulation
min_cvd_notional_usd = 1_000_000   # Minimum CVD magnitude
ks_statistic_threshold = 0.15      # TWAP uniformity test threshold
snapshot_interval_seconds = 10     # CVD snapshot persistence frequency

[clickhouse]
host = "127.0.0.1"
port = 8123
database = "quant_db"
user = "quant_writer"
batch_size = 1000                  # Rows per batch
flush_interval_ms = 50             # Max time between flushes
dlq_path = "/var/lib/quant-engine/dlq"

[redis]
url = "redis://127.0.0.1:6379"     # Matches existing REDIS_URL in .env
alerts_channel = "quant:alerts"
heartbeat_interval_seconds = 5

[metrics]
prometheus_port = 9090
```

---

*This document constitutes the complete technical blueprint for the Project Sovereign Rust Data Ingestion Engine. All specifications are production-ready and calibrated for the existing QUANTUM MON CHERI infrastructure. Proceed to Phase 1 implementation upon approval.*
