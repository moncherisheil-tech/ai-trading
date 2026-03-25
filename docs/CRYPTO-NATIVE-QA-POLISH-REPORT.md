# Crypto-Native QA & Polish Report

**Document type:** Domain-specific audit (Crypto Quant / Algo Trader / QA)  
**Scope:** Asset precision, paper trading realism, exchange API resilience, and crypto UX/terminology  
**Status:** Pre-implementation — refactors listed for explicit approval before coding.

---

## Executive Summary

The codebase uses **Decimal.js** consistently for PnL and fee math and has solid structure. From a **crypto-native** perspective, several gaps will cause incorrect behavior for altcoins/memecoins, unrealistic paper trading results, and higher risk of exchange rate limits or false alerts. This report details the current state, expert critique, and required refactors per pillar.

---

## Pillar 1: Asset Precision & Tick Sizes

### 1.1 Price & Amount Formatting

#### Current Status

- **`lib/decimal.ts`**: Provides `round2`, `round4`, `formatFiat` (2 decimals), and `formatCrypto(value, maxDecimals = 8)` with trailing-zero trim and length cap. No symbol-aware logic.
- **Simulation & virtual portfolio**: `amountAsset` is computed as `round4(amt.div(pr))` in `SimulationContext.tsx` (line 137). Simulation summary and DB use `round2(p.amountAsset)` and `round2(avgEntry)`, `round2(currentPrice)` for positions (`app/api/simulation/summary/route.ts` lines 105–109).
- **UI display**: 
  - **GemsStrip.tsx** (line 62): `t.price >= 10 ? t.price.toFixed(2) : t.price.toFixed(4)` — no handling for sub‑0.0001 prices.
  - **CryptoTicker.tsx** (line 130): Same rule: `ticker.price >= 10 ? toFixed(2) : toFixed(4)`.
  - **PnlTerminal.tsx**: Position table uses `p.amountAsset.toFixed(4)` and `p.currentPrice.toFixed(2)` (lines 579, 581); trade table uses `t.price.toFixed(2)` (line 610). No symbol-based rules.
  - **CryptoAnalyzer.tsx**, **portfolio/page.tsx**, **SimulateBtcButton.tsx**: Mix of `toFixed(0/1/2)`, `toLocaleString()` for prices/amounts without symbol awareness.

#### Crypto-Expert Critique

- **BTC** typically needs 2 decimals for price and 5–8 for amount; **ETH** 2–4 for price. **Memecoins** (e.g. SHIB, PEPE, FLOKI) trade at 8+ decimal places (e.g. 0.00001234). Forcing everything to 2 or 4 decimals:
  - Truncates or rounds micro-cap prices (e.g. SHIB to 0.00), making displayed price wrong.
  - Rounds `amountAsset` to 2 decimals in the summary API, so position size for small units is wrong and PnL is distorted.
- Using a single `round4` for all `amountAsset` under-represents precision for BTC (often 8 decimals) and over-rounds for coins with large nominal quantities. Exchanges enforce **tick size** and **lot size** per symbol; ignoring them makes simulated fills and displayed positions inconsistent with real exchange behavior.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`lib/decimal.ts`** | Add symbol-aware helpers, e.g. `getPriceDecimals(symbol: string): number` and `getAmountDecimals(symbol: string): number` (or use a small static map: BTC/ETH 2–4, known memecoins 6–8, default 4–6). Optionally `formatPriceForSymbol(price, symbol)` and `formatAmountForSymbol(amount, symbol)` using `formatCrypto` with the right decimals. |
| **`context/SimulationContext.tsx`** | Use symbol-based amount decimals for `amountAsset` (e.g. `roundToDecimals(amt.div(pr), getAmountDecimals(normalizedSymbol))`) instead of fixed `round4`. |
| **`app/api/simulation/summary/route.ts`** | For each position, use symbol-based rounding: `amountAsset`, `avgEntryPrice`, `currentPrice` via shared precision helpers (not universal `round2`). Keep `costUsd` and `unrealizedPnlUsd` in USD with `round2`. |
| **`components/GemsStrip.tsx`** | Replace fixed `toFixed(2/4)` with symbol-based price formatting (e.g. `formatPriceForSymbol(t.price, t.symbol)` or logic: price &lt; 0.01 → 8 decimals, &lt; 1 → 6, &lt; 10 → 4, else 2). |
| **`components/CryptoTicker.tsx`** | Same as GemsStrip for price and change %. |
| **`components/PnlTerminal.tsx`** | Positions: format `amountAsset` and `currentPrice` by symbol (e.g. from a shared helper or prop). Trades: format `price` by symbol. Use `formatFiat` for USD amounts. |
| **`lib/db/virtual-portfolio.ts`** | Schema already uses `NUMERIC(24,8)` for prices — ensure all reads/writes use full precision; avoid forcing to 2 decimals in API responses for price fields. |
| **`app/portfolio/page.tsx`**, **`components/CryptoAnalyzer.tsx`** | Use symbol-aware price/amount formatting wherever prices or asset quantities are displayed. |

---

### 1.2 Math Logic (Decimal.js, Division-by-Zero, Near-Zero)

#### Current Status

- PnL and fee calculations use **Decimal.js** in `SimulationContext`, `simulation-service`, `virtual-portfolio`, `app/api/simulation/summary/route.ts`, and `app/api/ops/metrics/pnl/route.ts`. `toDecimal` and `safeNumeric` in `lib/decimal.ts` coerce null/NaN to 0.
- **virtual-portfolio.ts** `closeVirtualTrade`: `if (entry.isZero()) return;` before `div(entry)` (line 95).
- **simulation-service.ts** `checkAndCloseTrades`: `if (price == null || price <= 0 || trade.entry_price <= 0) continue;` and `if (entry.isZero()) continue;` before PnL % (lines 62–65).
- **simulation/summary**: Unrealized PnL = `(currentPrice - avgEntry) * amountAsset`; `avgEntry = p.buyAmount > 0 ? p.buyCostUsd / p.buyAmount : 0` — no division by zero. If `currentPrice` is 0, `toDecimal(0)` is used; no explicit guard for `currentPrice <= 0` when displaying or aggregating.

#### Crypto-Expert Critique

- Coins can **trade near zero** (e.g. rugged tokens). If the API returns `0` or a tiny value, `entry.isZero()` and `price <= 0` guards prevent crashes, but:
  - A position with `entry_price` very small and `currentPrice === 0` could show huge negative unrealized PnL %; the UI and any downstream logic should treat “price missing or zero” as invalid for PnL rather than showing -100% or NaN.
- **Backtest PnL** in `app/api/ops/metrics/pnl/route.ts`: `tradePnL` uses `entry.price_diff_pct`; if `price_diff_pct` is extreme (e.g. -100%), the math is finite but the **profit factor** calculation does `grossLoss.greaterThan(0) ? grossProfit.div(grossLoss) : ...`. If both are 0, result is 0 — correct. If `grossLoss` is 0 and `grossProfit > 0`, result is 999 — acceptable. No division by zero found, but **percentage display** (e.g. totalPnlPct) uses `startingBalance.isZero() ? 0 : ...` (line 96) — good.
- **Summary route** positions: if Binance returns `price: "0"` or a bad value, `currentPrice` can be 0; unrealized PnL becomes negative (correct) but displaying “$0.00” for current price and still showing a position can confuse. Filtering or flagging “stale/zero price” is recommended.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`lib/decimal.ts`** | Consider exporting a small helper e.g. `safePnlPercent(entry, exit)` that returns `null` or a sentinel when `entry <= 0` or `!Number.isFinite(…)`, so callers can show “—” or skip. |
| **`app/api/simulation/summary/route.ts`** | When building positions, if `currentPrice` is 0 or not finite, either exclude the position from the list or mark it as “price unavailable” and set `unrealizedPnlUsd` to 0 or null so the UI does not show misleading -100% style PnL. |
| **`lib/simulation-service.ts`** and **`lib/db/virtual-portfolio.ts`** | Keep existing zero checks; add a comment that near-zero entry prices are intentionally skipped to avoid division-by-zero and that “price unavailable” should be handled at the API/UI layer. |
| **All PnL % display paths** | Ensure no raw `NaN` or `Infinity` is rendered (e.g. use `Number.isFinite(x) ? format(x) : '—'` or equivalent). |

---

## Pillar 2: Trading Engine Realism (Paper Trading)

### 2.1 Fees & Slippage

#### Current Status

- **Fee**: Single rate **0.1%** applied in `SimulationContext` (`SIMULATION_FEE_PCT`), simulation DB, virtual portfolio (backtest in `app/api/ops/metrics/pnl/route.ts` uses `D.feePct` 0.1%). No distinction between maker and taker.
- **Slippage**: None. Simulated execution uses the exact price passed in (user or API last price).

#### Crypto-Expert Critique

- Real spot exchanges use **maker/taker** (e.g. Binance spot ~0.1% taker, 0.1% or lower maker). A single 0.1% is a reasonable simplification but should be documented as “taker-like” for market orders. For limit orders (if ever added), maker fee would be lower.
- **No slippage** is unrealistic for market orders, especially on volatile or thin books. In live markets, a market buy often fills at worse than last price (positive slippage for buys). Paper trading that assumes perfect fills inflates backtest and virtual PnL versus real execution.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`context/SimulationContext.tsx`** | Keep 0.1% fee; add a constant e.g. `SIMULATION_SLIPPAGE_BPS = 5` (5 bps = 0.05%) and apply it for “market” execution: e.g. buy at `price * (1 + slippage)`, sell at `price * (1 - slippage)`. Use Decimal for the adjustment. Document that fee is taker-equivalent. |
| **`app/api/simulation/trades/route.ts`** | If the server ever derives price (e.g. from Binance), apply the same slippage before persisting. |
| **`lib/simulation-service.ts`** | When closing with `livePrices`, optionally apply slippage to the exit price (e.g. for “market” close). |
| **`app/api/ops/metrics/pnl/route.ts`** | Document that backtest uses 0.1% round-trip fee and no slippage; optionally add a small slippage term to `tradePnL` for realism. |
| **Config / env** | Consider `PAPER_SLIPPAGE_BPS` (and optionally `PAPER_FEE_MAKER_BPS` / `PAPER_FEE_TAKER_BPS`) for future flexibility. |

---

### 2.2 Order Execution (Last Price vs Order Book)

#### Current Status

- **Simulation (SimulationContext)**: User or UI supplies `price` and `amountUsd`; no server-side fetch of price. So execution is “at the price given.”
- **Simulation summary** (`app/api/simulation/summary/route.ts`): Unrealized PnL uses **Binance `ticker/price`** (last traded price) per symbol. No order book (depth) or bid/ask.
- **Virtual portfolio** (`app/api/portfolio/virtual/route.ts`): Open trade uses `entry_price` from request body (e.g. from scanner or user). Price updates for **checkAndCloseTrades** use **Binance `ticker/price`** again (last price). No bid/ask.

#### Crypto-Expert Critique

- **Last price** is not the execution price for a market order: a **market buy** fills at the **ask** (often above last), **market sell** at the **bid** (often below last). Using last price for both directions and for marking-to-market systematically underestimates cost and can overstate PnL.
- For **paper trading**, the minimal fix is to document “we use last price as a proxy; execution would be worse in practice.” A better fix is to fetch **best bid/ask** (e.g. Binance `ticker/bookTicker`) and simulate: buy at ask, sell at bid; mark-to-market using mid or last with a note.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`app/api/simulation/summary/route.ts`** | Option A (quick): Keep last price; add a short comment in code and in UI tooltip that “מחיר נוכחי” is last price and execution would be at bid/ask. Option B (realistic): Add a small helper that fetches `bookTicker` for the position symbols; for each position use **ask** for marking long (conservative) or use **mid**; expose in API as `currentPrice` and optionally `bid`/`ask` for UI. |
| **`app/api/portfolio/virtual/route.ts`** | When running `checkAndCloseTrades(prices)`, the `prices` map is currently last price. If moving to bookTicker: build map of symbol → ask (for “sell to close” simulation) or mid. Prefer using **ask** when evaluating “price at which we could close a long” so stop/target checks are conservative. |
| **`lib/gem-finder.ts`** / **Binance usage** | No change required for gem list; execution realism is only needed in simulation and virtual portfolio. |
| **Documentation** | In docs or in-app help, state: “Paper trading uses last price (or bid/ask when implemented) for marking positions; real execution may differ.” |

---

### 2.3 Liquidation & Drawdown

#### Current Status

- **Liquidation**: None. No margin, no leverage-based liquidation. Virtual portfolio and simulation only track spot-like positions; positions can stay open with arbitrarily negative unrealized PnL.
- **Drawdown**: **Max drawdown** is computed in the **backtest PnL** API (`app/api/ops/metrics/pnl/route.ts`) from the equity curve (peak-to-trough). No cap on single-position or portfolio drawdown for the **live** paper/virtual flows. PnlTerminal shows “שפל מקס׳” (max drawdown) from backtest data only.

#### Crypto-Expert Critique

- In real leveraged or margin trading, positions are **liquidated** when equity falls below maintenance margin. Even in **spot-only** paper trading, allowing -500% unrealized PnL on a position is misleading: in practice the user would have closed or been stopped out. Failing to model any “stop out” or max drawdown cap makes paper results non-comparable to real behavior and can hide strategy risk.
- For **spot paper** with no leverage, a reasonable compromise is: (1) **No liquidation**, but (2) **Optional max drawdown or stop-out rule** (e.g. if unrealized PnL on a position goes below -X%, treat as “would have been stopped” and auto-close at a simulated stop price, or flag in UI). This keeps the engine simple but improves interpretability.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`lib/simulation-service.ts`** | In `checkAndCloseTrades`, today we only close when target profit or stop-loss % is hit. Add an optional **max drawdown** rule: e.g. if `pnlPct <= -MAX_POSITION_DRAWDOWN_PCT` (e.g. -50% or -80%), auto-close the trade at current price (or at a simulated stop price). Make threshold configurable (constant or env). |
| **`lib/db/virtual-portfolio.ts`** | Schema already has `stop_loss_pct`; ensure that when we compare `pct <= trade.stop_loss_pct`, we use the same sign convention (negative = loss). No schema change required unless you add a separate “liquidation” flag. |
| **`app/api/simulation/summary/route.ts`** and **PnlTerminal** | When displaying positions, optionally show a **warning** if unrealized PnL % is below a threshold (e.g. -30% or -50%): “הפסד לא ממומש גבוה — שקול סגירה” or “High unrealized loss.” |
| **`app/api/ops/metrics/pnl/route.ts`** | Backtest already computes max drawdown from equity curve; no change required. Optionally add a note in the response or docs that this is historical and does not include liquidation. |
| **Config** | Add e.g. `PAPER_MAX_POSITION_DRAWDOWN_PCT = -50` (or -80) for the optional auto-close rule; 0 = disabled. |

---

## Pillar 3: Exchange API & Data Resilience

### 3.1 Rate Limits & 429 Handling

#### Current Status

- **Binance REST**: Used in `app/actions.ts` (fetchJson with `withRetry`), `lib/analysis-core.ts` (withRetry), `lib/gem-finder.ts` (single fetch, no retry), `app/api/simulation/summary/route.ts` (single fetch, 10s timeout, no retry), `app/api/portfolio/virtual/route.ts` (single fetch, no timeout/retry). **withRetry** in actions and analysis-core uses fixed delay + jitter (150*(attempt+1) + 0–180 ms); **no** inspection of 429 or `Retry-After` header.
- **Gemini**: 429 is detected in `lib/analysis-core.ts` (`isQuotaExhausted`); on 429 the code falls back to `quotaFallbackModel` and throws `QUOTA_EXHAUSTED_429` after retry. No exponential backoff for Binance.
- **Telegram**: `lib/telegram.ts` returns `rateLimitRetryAfter` when status is 429 and parses `retry_after` from the body.
- **Cron** (`app/api/cron/scan/route.ts`): Calls `runOneCycle()` which uses `getCachedGemsTicker24h()` (one Binance 24h ticker call) then **sequential** `doAnalysisCore(symbol)` for up to 12 symbols — each analysis does Binance klines + Gemini. No spacing between symbols; risk of burst 429 from Binance or Gemini.

#### Crypto-Expert Critique

- Binance enforces **IP-based** and **endpoint** rate limits (e.g. 1200 weight/min). A single ticker/price or ticker/24hr call is low weight, but **many klines** in a short window (e.g. 12 symbols × 1 call each in analysis) can approach the limit. If the cron runs while the dashboard is also polling (e.g. simulation summary, portfolio virtual), total Binance traffic can spike.
- **429 from Binance** does not set a standard `Retry-After` in all cases; the response body may include a `retryAfter` or similar. Currently we retry with a fixed delay regardless of status; we do not back off more aggressively on 429 or respect server-provided wait time. That can lead to repeated 429s and eventual IP ban or long cooldown.
- **Cron**: Running 12 analyses back-to-back with no delay increases the chance of hitting both Binance and Gemini limits in one run.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`app/actions.ts`** and **`lib/analysis-core.ts`** | In `withRetry` or in the fetch wrapper: when `res.status === 429`, read `Retry-After` (or Binance-specific header/body field) and wait that many seconds before retry; if missing, use **exponential backoff** (e.g. 2^attempt seconds, cap 60s). Optionally separate “retry on 5xx / timeout” from “retry on 429 with longer wait.” |
| **`lib/gem-finder.ts`** | Wrap the Binance 24h ticker fetch in the same retry/backoff logic (or a shared `fetchWithRetry` that handles 429). Avoid calling fetch twice (proxy then direct) without a delay when the first call fails. |
| **`app/api/simulation/summary/route.ts`** | Use shared retry/backoff for `fetchPricesForSymbols`; on 429, back off and retry once or twice instead of returning empty map (which would show $0 or missing prices). |
| **`app/api/portfolio/virtual/route.ts`** | Add timeout (e.g. 10s) and retry/backoff for `fetchPricesForSymbols` so virtual portfolio is resilient to temporary 429. |
| **`lib/workers/market-scanner.ts`** | Add a **delay between symbols** (e.g. 2–5 seconds) in the loop over `candidates` before calling `doAnalysisCore`, to spread Binance and Gemini load and reduce 429 risk. Make delay configurable (constant or env). |
| **`lib/config.ts`** | Add e.g. `binanceRetryAfterSeconds` (default 60) and `scannerDelayBetweenSymbolsMs` (e.g. 3000) for tuning. |
| **`lib/cache-service.ts`** | Keep 5-minute cache for gems ticker; consider slightly longer (e.g. 6–10 min) during high traffic to reduce Binance calls. Document that cache is the first line of defense against rate limits. |

---

### 3.2 Flash Crashes & Anomalous Data

#### Current Status

- **Gem finder**: Filters by `MIN_VOLUME_24H_USD` and `MIN_LIQUIDITY_USD` (50k / 100k). No check on **price change magnitude** or **high-low spread**.
- **Scanner**: Uses AI analysis and confidence threshold; no explicit filter on 24h price change or wick size.
- **Binance data**: Parsed as-is; no outlier detection. If the API returns a bad tick (e.g. 50% drop due to a glitch or thin book wick), that value can flow into: gem list, analysis entry price, simulation summary current price, and virtual portfolio close logic.

#### Crypto-Expert Critique

- **Flash crashes** and **bad ticks** are common in crypto. A single anomalous print can trigger: (1) a “Gem” with a fake -50% move, (2) a false entry/exit price in paper trading, (3) stop-loss or target triggered on a wick that would not have been filled in reality. This degrades trust in both the scanner and the paper engine.
- Simple defenses: (1) **Sanity bounds** on 24h change (e.g. ignore or flag if abs(priceChangePercent) > 50% for “current” display or for triggering alerts). (2) **Comparison with 24h high/low**: if “last price” is outside [low, high] by more than a small tolerance, treat as stale or use high/low as clamp. (3) **Optional confirmation**: require two consecutive reads or a short delay before treating a large move as real.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`lib/gem-finder.ts`** | When parsing 24h ticker, optionally **filter out** or **flag** symbols where `abs(priceChangePercent) > MAX_SANE_CHANGE_PCT` (e.g. 40–50%) so they are not promoted as “gems” on a single bad tick. Alternatively, add a field `isAnomalous` and let the scanner skip or down-rank them. |
| **`app/api/simulation/summary/route.ts`** and **`app/api/portfolio/virtual/route.ts`** | When fetching current price for a symbol, if you have 24h high/low (e.g. from a prior ticker/24hr call or a separate cache), **clamp** or **reject** last price if it lies outside [low * 0.99, high * 1.01] (or similar). If no high/low, at least reject `price <= 0` and optionally reject if price is e.g. &gt; 2× or &lt; 0.5× a recent cached price for that symbol. |
| **`lib/workers/market-scanner.ts`** | Before sending a “Gem” alert, optionally check that the entry price used is within the 24h range (from the same ticker data) to avoid alerting on a spike/wick. |
| **`lib/analysis-core.ts`** | If klines or ticker are used for entry price, ensure the value is within a reasonable range (e.g. within 24h high/low); if not, log and use a fallback (e.g. previous close or skip analysis). |
| **Config** | Add `MAX_SANE_PRICE_CHANGE_PCT_24H` (e.g. 50) and optionally `PRICE_CLAMP_TO_24H_RANGE: boolean` for the above. |

---

## Pillar 4: Crypto-Specific Metrics & Terminology

### 4.1 UI/UX Terminology

#### Current Status

- **PnlTerminal**: Uses “תיק” (portfolio), “רווח/הפסד” (PnL), “אחוז הצלחה” (win rate), “מקדם רווח” (profit factor), “שפל מקס׳” (max drawdown). No explicit “ROE” or “Volume 24h” in the main cards. Backtest PnL is “מסוף רווח והפסד” with same metrics.
- **Portfolio page**: “מאזן וירטואלי (Paper Trading)”, “אחוז הצלחה”, “רווח/הפסד יומי”. No “Risk/Reward” or “Volume 24h” on the main dashboard.
- **GemsStrip**: “ג'מס” (gems); no “Volume 24h” label next to the strip (aria-label says “נפח 24 שעות”).
- **CryptoAnalyzer**: “מחיר חי — Binance”, “סיכון”, “תחזית 24h”, “הסתברות”. Terms are reasonable but not always the exact industry terms (e.g. “ROE” vs “return on equity” vs “PnL %”).

#### Crypto-Expert Critique

- **ROE** (return on equity) is standard in leveraged/margin contexts; for spot paper, “PnL %” or “תשואה” is equivalent. Using “רווח נקי (%)” is clear; adding a tooltip “ROE / PnL %” would align with trader jargon.
- **Volume 24h** is critical for crypto; it should be visible where gems or symbols are shown (e.g. in GemsStrip or analyzer) so traders can judge liquidity at a glance.
- **Risk/Reward ratio** is often shown per trade or per strategy; currently we have target % and stop-loss % but no explicit “R:R” display. Optional but valuable.
- **Drawdown** is correctly “שפל מקסימלי”; “Max DD” or “מקס דרודאון” are also common; current label is fine.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`components/PnlTerminal.tsx`** | Add a short tooltip or label hint for “רווח נקי (%)” that says “PnL % / ROE (on initial balance)”. Consider adding a compact “נפח 24h” (Volume 24h) in the simulation/positions section if you have the data (e.g. from ticker cache). |
| **`components/GemsStrip.tsx`** | Show **Volume 24h** (e.g. `quoteVolume` in USD) per gem: e.g. “$1.2M” or “1.2M$” next to each ticker, with aria-label “נפח 24 שעות”. Use a compact format (K/M/B). |
| **`app/portfolio/page.tsx`** | If virtual trades show symbol, consider adding a column or tooltip for “Volume 24h” when available. Keep “Paper Trading” and “סימולציה” consistent. |
| **`components/CryptoAnalyzer.tsx`** | Where entry and target are shown, optionally display **Risk/Reward** (e.g. “R:R = (target − entry) / (entry − stop)” as a ratio). Ensure “תחזית 24h” and “הסתברות” are clearly labeled. |
| **`lib/i18n.ts`** | Add keys for “Volume 24h”, “Risk/Reward”, “ROE” if you want to centralize terminology. |
| **Docs / in-app** | In a short “מראה מונחים” or help section, list: PnL, Win Rate, Profit Factor, Max Drawdown, Volume 24h, ROE, Paper Trading. |

---

### 4.2 Visual Indicators (Positive/Negative, Volume, Trend)

#### Current Status

- **PnlTerminal**: Positive PnL and balance use `text-emerald-400` / `#34d399`; negative use `text-rose-500` / `#f43f5e`. Bar chart P&L cells use same colors. Risk status (extreme_fear / extreme_greed) uses amber/red/emerald. Leverage slider and PDF export are present.
- **GemsStrip**: Up/down by `priceChangePercent >= 0`; green (emerald) / red (rose); TrendingUp / TrendingDown icons.
- **CryptoTicker**: Same pattern: green/red by `change >= 0`, with icons.
- **CryptoAnalyzer**: Direction Bullish/Bearish/Neutral with color; risk_level_he maps to red/emerald/amber.

#### Crypto-Expert Critique

- Color usage is **consistent** and readable (green = positive, red = negative). One minor improvement: ensure **accessibility** (contrast, and not relying only on color for “up/down”) — icons already support that.
- **Volume spike** is not visually indicated: e.g. “נפח גבוה מהממוצע” or an icon when 24h volume is 2× the recent average would help. This can be a later enhancement once volume is displayed.
- **Trend**: Current setup shows direction and % change; adding a small “trend strength” or “momentum” indicator (e.g. from RSI or price vs MA) would be a polish item, not a must for this audit.

#### Required Refactor

| Location | Change |
|----------|--------|
| **`components/GemsStrip.tsx`** and **`components/CryptoTicker.tsx`** | Ensure negative zero is treated as “down” (e.g. `priceChangePercent < 0` for red, not `<= 0`) so 0% is not shown as green. Add aria attributes for screen readers (e.g. “שינוי מחיר: עלייה X%” / “ירידה X%”). |
| **`components/PnlTerminal.tsx`** | Keep existing colors; ensure PDF export uses the same semantic (green/red) for positive/negative. Add aria-live or role for key metric changes if the values update dynamically. |
| **`components/CryptoAnalyzer.tsx`** | Keep Bullish/Bearish/Neutral colors; ensure risk_level_he has sufficient contrast. Optional: add a small “volume” badge (e.g. “נפח גבוה”) when quoteVolume &gt; threshold. |
| **Global** | Consider a shared token for “positive” and “negative” (e.g. CSS variables or Tailwind theme) so all crypto screens stay consistent. |

---

## Summary Table: Refactor Priorities

| Priority | Pillar | Item | Files / Areas |
|----------|--------|------|----------------|
| **P0** | 1 | Symbol-aware price/amount precision | decimal.ts, SimulationContext, simulation/summary, GemsStrip, CryptoTicker, PnlTerminal |
| **P0** | 2 | Execution: last price vs bid/ask (document or use bookTicker) | simulation/summary, portfolio/virtual |
| **P0** | 3 | 429 handling and backoff for Binance | actions.ts, analysis-core.ts, gem-finder.ts, simulation/summary, portfolio/virtual |
| **P0** | 3 | Scanner delay between symbols | market-scanner.ts, config |
| **P1** | 1 | Safe PnL % and zero-price handling in summary | decimal.ts, simulation/summary |
| **P1** | 2 | Slippage for paper trades | SimulationContext, simulation/trades, simulation-service, ops/metrics/pnl |
| **P1** | 2 | Optional max drawdown auto-close / warning | simulation-service, summary, PnlTerminal, config |
| **P1** | 3 | Anomalous price filtering (flash crash) | gem-finder.ts, simulation/summary, portfolio/virtual, market-scanner |
| **P2** | 4 | Volume 24h in UI and terminology polish | GemsStrip, PnlTerminal, portfolio, CryptoAnalyzer, i18n |
| **P2** | 4 | Visual consistency and a11y | GemsStrip, CryptoTicker, PnlTerminal, CryptoAnalyzer |

---

**Next step:** Await your explicit approval on which refactors to implement first; then implementation can proceed in the order you specify (e.g. P0 only, or by pillar).
