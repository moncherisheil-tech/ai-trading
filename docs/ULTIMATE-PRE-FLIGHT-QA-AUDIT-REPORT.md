# Ultimate Pre-Flight QA Audit Report

**Project:** Trading / Market Scanner & Simulation Platform (RTL Hebrew)  
**Audit Type:** Pre-Flight Production Readiness — Full Codebase  
**Scope:** All 8 Pillars (full report)

---

## Pillar 1: Backend Architecture & Data Integrity

### 1.1 API & Error Handling

| Check | Status | Details |
|-------|--------|---------|
| **try/catch on API routes** | ⚠️ **PARTIAL** | Most routes have try/catch. **FAIL:** `app/api/cron/retrospective/route.ts` — no try/catch around `runRetrospectiveAndReport()` or `sendTelegramMessage()`. If either throws (DB/network), the handler returns 500 with no structured error body and no logging. |
| **Timeouts on external calls** | ⚠️ **PARTIAL** | **PASS:** `lib/analysis-core.ts` uses `APP_CONFIG.fetchTimeoutMs` (12s) and AbortController for Binance/Gemini. `lib/telegram.ts` uses `TELEGRAM_API_TIMEOUT_MS` (10s). **FAIL:** `app/api/simulation/summary/route.ts` — `fetchPricesForSymbols()` calls Binance with no timeout; a slow/blocked Binance can hang the GET request. **FAIL:** `app/api/ops/verify-symbols/route.ts` has 8s timeout (good); other API routes that call external APIs may not. |
| **Rate-limit handling (external)** | ✅ **PASS** | `lib/analysis-core.ts`: `isQuotaExhaustedError()` detects 429/RESOURCE_EXHAUSTED and triggers fallback. `lib/telegram.ts` returns `rateLimitRetryAfter` and handles 429. |
| **Cron error handling** | ⚠️ **PARTIAL** | **PASS:** `app/api/cron/scan/route.ts` — try/catch, sets last scan timestamp even on failure, returns 500 with message. **FAIL:** `app/api/cron/retrospective/route.ts` — no try/catch; any throw propagates as 500. **PASS:** `app/api/cron/morning-report/route.ts` — awaits `runMorningReport()` and returns error response. |
| **WebSocket (client)** | ✅ **PASS** | Client WebSockets in `CryptoAnalyzer.tsx` and `CryptoTicker.tsx` are in useEffect with cleanup (close + clear timers). No server WebSocket. |
| **HTTP status on error** | ⚠️ **FAIL** | `app/api/ops/simulate/route.ts`: on catch, returns `NextResponse.json({ success: false, error: message }, { status: 200 })`. Clients cannot rely on HTTP status for errors; should return 500 (or 4xx) for failure. |

**Files involved (Pillar 1.1):**
- `app/api/cron/retrospective/route.ts` — add try/catch and error logging.
- `app/api/simulation/summary/route.ts` — add AbortController + timeout to `fetchPricesForSymbols()` (e.g. 8–10s).

---

### 1.2 Database & Models

| Check | Status | Details |
|-------|--------|---------|
| **Indexes** | ✅ **PASS** | `lib/db.ts` and `lib/db/postgres-repository.ts`: indexes on `prediction_records(symbol, status, prediction_date)`. `lib/db/virtual-portfolio.ts`: indexes on `virtual_portfolio(status, entry_date)`. `lib/db/simulation-trades.ts`: index on `simulation_trades(timestamp)`. `lib/db/system-settings.ts`: singleton table by `id`. |
| **Missing indexes** | ⚠️ **MINOR** | `prediction_records` and `virtual_portfolio` queries often filter by `status` + date; composite index on `(status, prediction_date DESC)` could help. Not critical for current scale. |
| **Data consistency (simulated trade)** | ❌ **FAIL** | **Virtual portfolio (Telegram/DB):** `lib/db/virtual-portfolio.ts` — `insertVirtualTrade()` has no check that the virtual wallet has sufficient “balance.” Any amount_usd is accepted; multiple open trades can exceed a logical wallet. **Simulation trades (UI):** `app/api/simulation/trades/route.ts` (POST) — accepts client-provided trade (id, symbol, side, price, amountUsd, amountAsset, feeUsd, timestamp). No server-side validation that the trade is consistent with current wallet balance or open positions. A malicious or buggy client can insert arbitrary trades and corrupt state. |
| **Transactions** | ⚠️ **PARTIAL** | Single-statement operations (insert/update/delete) per route; no multi-step transactions. `saveAllAsync` in postgres-repository does DELETE then multiple INSERTs — not atomic; a failure mid-loop can leave partial data. |

**Files involved (Pillar 1.2):**
- `lib/db/virtual-portfolio.ts` — consider a logical “virtual wallet” balance (e.g. from closed PnL or fixed cap) and reject insert when amount would exceed it.
- `app/api/simulation/trades/route.ts` — server-side validation: recompute wallet from existing trades and validate that the new trade (buy/sell) is consistent with balance and position before insert.
- `lib/db/postgres-repository.ts` — consider transaction for `saveAllAsync` (BEGIN; DELETE; INSERTs; COMMIT).

---

### 1.3 State Synchronization (Frontend ↔ Backend)

| Check | Status | Details |
|-------|--------|---------|
| **Scanner active state** | ✅ **PASS** | Scanner on/off is stored in `system_settings` (Postgres). GET/POST `app/api/settings/scanner/route.ts` read/update it. UI can poll or refetch after toggle. |
| **Wallet / simulation state** | ⚠️ **PARTIAL** | **PASS:** `context/SimulationContext.tsx` hydrates from `GET /api/simulation/trades` on mount and pushes new trades via POST then updates local state. **FAIL:** No invalidation when the same data is modified from another tab or from Telegram (virtual trade). User in the app can see stale wallet/positions until refresh. **FAIL:** POST `/api/simulation/trades` does not verify that the client’s view of wallet/positions matches server; race conditions (e.g. two tabs) can produce inconsistent state. |
| **Last scan timestamp** | ✅ **PASS** | Cron scan updates `last_scan_timestamp` in DB; settings API returns it; scanner state can combine DB + in-memory `getScannerState()` from market-scanner worker. |

**Files involved (Pillar 1.3):**
- `context/SimulationContext.tsx` — consider periodic refetch or refetch on focus so that Telegram-originated virtual trades and other tabs are reflected.
- `app/api/simulation/trades/route.ts` — enforce server-side consistency (wallet/position) before persisting so state cannot be corrupted by client or races.

---

## Pillar 2: Security & Authentication (DevSecOps)

### 2.1 Data Sanitization (XSS / SQL Injection)

| Check | Status | Details |
|-------|--------|---------|
| **SQL injection** | ✅ **PASS** | All DB access uses parameterized queries (`@vercel/postgres` template literals with `${}`). No string concatenation of user input into SQL. |
| **XSS (Telegram → UI)** | N/A | Telegram messages are rendered by Telegram client, not in your app’s DOM. |
| **XSS (user input in app)** | ⚠️ **ASSUMED** | React escapes by default. User-controlled content that is rendered as HTML (e.g. rich text) was not audited; ensure no `dangerouslySetInnerHTML` with unsanitized input. |
| **Telegram command/callback input** | ✅ **PASS** | `app/api/telegram/webhook/route.ts`: symbol from text/callback is validated with `isSupportedBase(base)`; numbers from callback are `parseFloat` with checks (`entryPrice > 0 && amountUsd > 0`). Logic uses validated symbol and numeric values. `escapeHtml()` used for content sent back to Telegram (market-scanner, `lib/telegram.ts`). |
| **Numeric bounds (Telegram)** | ⚠️ **MINOR** | Callback data `amountUsd` has no server-side max; a very large value could be used for virtual trade. Consider capping (e.g. max 10,000 USD equivalent). |

**Files involved (Pillar 2.1):**
- `app/api/telegram/webhook/route.ts` — add a reasonable max for `amountUsd` (and optionally `entryPrice`) when opening a virtual trade from callback.

---

### 2.2 Authentication & Sessions

| Check | Status | Details |
|-------|--------|---------|
| **Session token (cookie)** | ✅ **PASS** | `app/api/auth/login/route.ts`: cookie `app_auth_token` set with `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 12h`. |
| **Token verification** | ✅ **PASS** | `lib/session.ts`: HMAC-SHA256 signature, timing-safe compare, expiry check. Secret rotation via `APP_SESSION_SECRET` and `APP_SESSION_SECRET_PREVIOUS`. |
| **Middleware protection** | ✅ **PASS** | `middleware.ts`: requires auth cookie for non-whitelisted paths; whitelist includes `/login`, `/api/telegram/webhook`, auth endpoints, static assets. |
| **Role-based access** | ✅ **PASS** | Scanner POST (admin only) and other ops routes use `hasRequiredRole(session.role, 'admin')`. |

**Files involved (Pillar 2.2):** No changes required for this subsection.

---

### 2.3 Environment Variables & Secrets

| Check | Status | Details |
|-------|--------|---------|
| **Secrets not exposed to client** | ✅ **PASS** | No `NEXT_PUBLIC_` for secrets. `CRON_SECRET`, `WORKER_CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`/`POSTGRES_URL`, `APP_SESSION_SECRET`, `GEMINI_API_KEY`, etc. are used only server-side (`lib/config.ts`, `lib/env.ts`, API routes, workers). |
| **Optional public URL** | ✅ **PASS** | `NEXT_PUBLIC_APP_URL` is optional and used for base URL only; documented in `.env.example`. |

**Files involved (Pillar 2.3):** None.

---

### 2.4 Rate Limiting

| Check | Status | Details |
|-------|--------|---------|
| **Analysis (UI / server action)** | ✅ **PASS** | `app/actions.ts`: `allowRequest()` (in-memory) and `allowDistributedRequest()` (Upstash when configured) limit analysis requests per key (`APP_CONFIG.analysisRateLimitMax` per `analysisRateLimitWindowMs`). |
| **API routes (general)** | ❌ **FAIL** | No global or per-route rate limiting on Next.js API routes. Auth-protected routes can be spammed by an authenticated user; cron routes are protected by secret only. |
| **Telegram webhook** | ❌ **FAIL** | `app/api/telegram/webhook/route.ts` has no rate limiting. A single chat can send many commands (e.g. /analyze, /portfolio) and stress the server or external APIs (Gemini, Binance). |
| **Login** | ⚠️ **PARTIAL** | IP allowlist via `ALLOWED_IPS` and CSRF reduce abuse; no explicit login rate limit (e.g. 5 attempts per IP per 15 min). |

**Files involved (Pillar 2.4):**
- Add rate limiting for sensitive API routes (e.g. login, simulation/trades POST, settings scanner POST) — e.g. per-IP or per-session.
- Add rate limiting for Telegram webhook (e.g. per chat_id or per update_id window) to avoid command flooding.

---

## Pillar 3: Performance & Optimization

### 3.1 React Optimization (Re-renders, useMemo, useCallback)

| Check | Status | Details |
|-------|--------|---------|
| **Heavy data (tables/charts)** | ⚠️ **PARTIAL** | **PASS:** `PnlTerminal.tsx` uses `useMemo` for `sortedTrades`, `paginatedTrades`, and derived chart data (`equityCurveScaled`, `dailyPnlScaled`, etc.). **FAIL:** `handleSort` and `exportPdf` are not wrapped in `useCallback`; new function references every render (minor for this component, but can trigger child re-renders if passed down). |
| **Context value** | ✅ **PASS** | `SimulationContext` uses `useMemo` for the context value and `useCallback` for `setSelectedSymbol`, `addTrade`, `resetSimulation`, `getMarkersForSymbol`, `getTradesForSymbol`. `addTrade` depends on `state` (intentional for snapshot validation). |
| **Hydration** | ✅ **PASS** | `PnlTerminal.tsx` uses `suppressHydrationWarning` only where intended (client-time label). No obvious hydration mismatches. |

**Files involved (Pillar 3.1):**
- `components/PnlTerminal.tsx` — wrap `handleSort` and `exportPdf` in `useCallback` to avoid unnecessary re-renders of children (e.g. table headers, export button).

---

### 3.2 Bundle & Loading (Lazy-Loading)

| Check | Status | Details |
|-------|--------|---------|
| **Heavy components** | ✅ **PASS** | `CryptoAnalyzer.tsx` lazy-loads `PriceHistoryChart` via `dynamic(() => import('@/components/PriceHistoryChart'))`. `MainDashboard.tsx` lazy-loads `CryptoAnalyzer` with dynamic import. |
| **Charts on PnL page** | ⚠️ **PARTIAL** | `PnlTerminal.tsx` imports Recharts (AreaChart, BarChart, etc.) and jsPDF/html2canvas directly — no dynamic import. PnL page is already a dedicated route; acceptable but increases initial bundle for that page. |

**Files involved (Pillar 3.2):**
- Optional: dynamic-import Recharts and/or PDF libraries in `PnlTerminal.tsx` if PnL route bundle size is a concern.

---

### 3.3 Memory Leaks (Intervals, WebSockets, Listeners)

| Check | Status | Details |
|-------|--------|---------|
| **Intervals** | ✅ **PASS** | `PnlTerminal.tsx`: 1s interval for client time label is cleared in useEffect cleanup (`clearInterval(t)`). |
| **WebSockets** | ✅ **PASS** | `CryptoAnalyzer.tsx`: WebSocket closed in useEffect cleanup; `mounted` flag prevents state updates after unmount. `CryptoTicker.tsx`: WebSocket closed, `reconnectTimerRef` and `updateTimerRef` cleared in cleanup. |
| **Global listeners** | ⚠️ **MINOR** | `CryptoAnalyzer.tsx`: `window` keydown listener for Ctrl+Enter and Alt+E — ensure it is added/removed in the same useEffect with cleanup; verify no duplicate listeners on re-run. |

**Files involved (Pillar 3.3):** Confirm in `CryptoAnalyzer.tsx` that the keydown effect has a cleanup that removes the listener.

---

## Pillar 4: Financial Math & Trading Logic

### 4.1 Floating-Point Precision (Decimal Handling)

| Check | Status | Details |
|-------|--------|---------|
| **Wallet / PnL / fees** | ✅ **PASS** | `lib/decimal.ts` uses `decimal.js`. Simulation summary (`app/api/simulation/summary/route.ts`) uses `toDecimal()`, `round2()`. `context/SimulationContext.tsx` uses `toDecimal`, `round2`, `round4` for wallet and fee. Fee: `round4(amt.times(SIMULATION_FEE_PCT).div(100))`. |
| **Virtual portfolio (DB)** | ❌ **FAIL** | `lib/db/virtual-portfolio.ts`: `closeVirtualTrade()` computes `pnlPct = ((exitPrice - row.entry_price) / row.entry_price) * 100` with raw JavaScript numbers. `getVirtualPortfolioSummary()` in `lib/simulation-service.ts`: `totalRealizedPnlUsd` uses `(t.amount_usd * t.pnl_pct) / 100` — raw float. Stored in Postgres as NUMERIC; read back as float. For consistency and auditability, PnL and balances should use the same decimal utilities. |
| **RSI / formula** | ⚠️ **ACCEPTABLE** | `lib/prediction-formula.ts`: `computeRSI()` uses raw arithmetic (avgGain/avgLoss, etc.). Used for indicators and display; not for wallet balance. Acceptable; optional to use Decimal for reproducibility. |
| **Backtest / evaluation** | ⚠️ **ASSUMED** | Backtester and PnL metrics likely consume already-stored or Decimal-rounded values; not fully traced. Ensure any new balance/PnL path uses `lib/decimal.ts`. |

**Files involved (Pillar 4.1):**
- `lib/db/virtual-portfolio.ts` — compute `pnlPct` (and any derived amounts) with `toDecimal`/`round2`/`round4` from `lib/decimal.ts` before storing.
- `lib/simulation-service.ts` — compute `totalRealizedPnlUsd` and cumulative percentages with Decimal and round for consistency.

---

### 4.2 Edge Cases (Zero Price, Trade Size, Fees)

| Check | Status | Details |
|-------|--------|---------|
| **Zero or negative price** | ⚠️ **PARTIAL** | `openVirtualTrade` (simulation-service) and Telegram webhook require `entry_price > 0` and `amount_usd > 0`. `checkAndCloseTrades` skips when `price <= 0` or `trade.entry_price <= 0`. **Gap:** No explicit handling if a coin price goes to zero in the UI or in stored data (e.g. display or division); ensure no division by zero in PnL or chart logic. |
| **Trade size vs balance** | ❌ **FAIL** | **Virtual portfolio:** `lib/simulation-service.ts` and `lib/db/virtual-portfolio.ts` do not check a “virtual wallet” before insert; any amount is allowed. **Simulation (UI):** Client-side `SimulationContext.addTrade` checks `walletUsd` and position; server `POST /api/simulation/trades` does not — server can accept trades that would make wallet negative or position negative. |
| **Fees calculated exactly** | ✅ **PASS** | Simulation: fee is `round4(amountUsd * SIMULATION_FEE_PCT / 100)` (0.1%) with Decimal in context. Simulation summary uses Decimal for wallet rollup. Virtual portfolio does not model fees; it’s position-based. |
| **Sell more than position** | ✅ **PASS** | `SimulationContext.addTrade` (sell): compares `amountAsset` to `boughtForSymbol - soldForSymbol` with small epsilon; returns `INSUFFICIENT_ASSET` if exceeded. Server does not re-validate. |

**Files involved (Pillar 4.2):**
- `lib/simulation-service.ts` / `lib/db/virtual-portfolio.ts` — enforce a virtual wallet or max exposure and reject inserts that would exceed it.
- `app/api/simulation/trades/route.ts` — server-side checks: wallet cannot go negative; sell amount cannot exceed open position (recompute from DB state).

---

### 4.3 Fee Consistency and Rounding

| Check | Status | Details |
|-------|--------|---------|
| **Fee rate** | ✅ **PASS** | Single constant `SIMULATION_FEE_PCT = 0.1` in context; used consistently. |
| **Rounding display** | ✅ **PASS** | `formatFiat`, `formatCrypto`, `round2`/`round4` used in API and UI. |

**Files involved (Pillar 4.3):** None.

---

## Summary (Pillars 1–4)

| Pillar | Pass | Partial / Minor | Fail |
|--------|------|------------------|------|
| **1. Backend & Data Integrity** | 6 | 4 | 3 |
| **2. Security & Auth** | 6 | 2 | 2 |
| **3. Performance** | 5 | 3 | 0 |
| **4. Financial Math & Trading** | 5 | 2 | 3 |

**Critical before production (Pillars 1–4):**
1. **Cron retrospective** — wrap in try/catch and log errors; return structured error response.
2. **Simulation summary** — add timeout to Binance price fetch.
3. **Simulation trades POST** — validate wallet and position on server; reject invalid trades.
4. **Virtual portfolio** — optional wallet/limit check; use Decimal for PnL and any balance math.
5. **Rate limiting** — add for Telegram webhook and for sensitive API routes (login, simulation POST).
6. **Telegram callback** — cap `amountUsd` (and optionally `entryPrice`) for virtual trade.

---

## Pillar 5: High-End UI/UX & RTL Perfection

### 5.1 RTL Consistency

| Check | Status | Details |
|-------|--------|---------|
| **Root layout** | ✅ **PASS** | `app/layout.tsx`: `<html lang="he" dir="rtl">`; `overflow-x-hidden` on html/body. |
| **Global RTL styles** | ✅ **PASS** | `app/globals.css`: `[dir='rtl'] { text-align: right; }`; RTL-specific card alignment. |
| **Pages & sections** | ✅ **PASS** | Main content areas set `dir="rtl"` on main/section: login, terms, privacy, settings, ops, ops/pnl, ops/strategies, insights, backtest, portfolio, error/global-error, loading states. |
| **Components** | ✅ **PASS** | AppHeader, MainDashboard, CryptoAnalyzer, PnlTerminal, ScannerControlPanel, SettingsTelegramCard, LegalDisclaimer, SymbolSelect (dropdown input `dir="rtl"`), ConfidenceVsRealityChart, PerformanceTrendsCharts, OpsMetricsBlock, EvaluatePredictionsButton. |
| **Tables** | ✅ **PASS** | PnlTerminal and strategies tables use `text-end` for numeric cells; headers and layout respect RTL. |
| **Charts** | ⚠️ **PARTIAL** | Recharts (AreaChart, BarChart) in PnlTerminal and other components are inside `dir="rtl"` containers; Recharts does not natively flip axes for RTL — X-axis labels may still flow LTR. No explicit `layout="rtl"` or mirroring. Acceptable for numeric charts; document if intentional. |
| **Ticker animation** | ⚠️ **MINOR** | `app/globals.css`: `.ticker-track` uses `transform: translateX(-50%)` (content scrolls left). In RTL, a right-to-left scroll might be expected; current animation is LTR-direction. Optional: use logical properties or `translateX(50%)` for RTL. |
| **Icons (directional)** | ⚠️ **PARTIAL** | ArrowLeft used for "back" (e.g. PnlTerminal "חזרה ללוח") — in RTL "back" is right, so ArrowRight might be more natural; not critical. Settings "חזרה" uses ArrowRight. |
| **Numbers & tabular-nums** | ✅ **PASS** | PnlTerminal and strategies tables use `tabular-nums` on dates and numeric cells for aligned columns. |

**Files involved (Pillar 5.1):**
- `app/globals.css` — consider RTL-aware ticker keyframes (e.g. `[dir='rtl'] .ticker-track` with opposite translate).
- Chart components — if strict RTL axis flip is required, configure Recharts or wrap in RTL-mirrored container.

---

### 5.2 Responsiveness (Mobile, Tablet, Desktop)

| Check | Status | Details |
|-------|--------|---------|
| **Mobile-first / overflow** | ✅ **PASS** | `overflow-x-hidden` on html, body, and main content; `min-w-0`, `max-w-full` used to avoid layout blowout. |
| **Tables** | ✅ **PASS** | PnlTerminal: table in `overflow-x-auto` with `min-w-[580px]` and `-webkit-overflow-scrolling: touch`. Strategies page: `overflow-x-auto`, table scrolls horizontally without breaking layout. |
| **Bottom nav** | ✅ **PASS** | BottomNav shows only on mobile (`useIsMobile()`); desktop uses header nav. Safe area inset: `pb-[env(safe-area-inset-bottom)]`. |
| **Touch targets** | ✅ **PASS** | Buttons and controls use `min-h-[44px]`, `touch-manipulation` where audited (PnlTerminal, CryptoAnalyzer, SymbolSelect, ScannerControlPanel, Settings). |
| **Breakpoints** | ✅ **PASS** | Consistent use of `sm:`, `md:`, `lg:` for spacing, grid columns, and visibility. |

**Files involved (Pillar 5.2):** None critical.

---

### 5.3 Loading Skeletons & Empty States

| Check | Status | Details |
|-------|--------|---------|
| **Loading skeletons** | ❌ **FAIL** | No dedicated skeleton components found. Route-level `loading.tsx` exists for ops, ops/pnl, ops/strategies (simple centered layout with "טוען…" or similar). Data-dependent views (e.g. PnlTerminal, CryptoAnalyzer, insights) show loading via inline state (spinner or "טוען") but no high-quality skeleton placeholders for tables or charts. |
| **Empty states** | ✅ **PASS** | PnlTerminal: "אין עדיין נתוני הון", "אין עדיין נתוני רווח והפסד", "אין עדיין עסקאות" when no data. Strategies table and trade list show "אין עדיין עסקאות" / empty message. CryptoTicker: "טוען זרם שוק…" when no tickers. |
| **Error state (data)** | ✅ **PASS** | PnlTerminal shows a clear message when `!data?.success`: "טעינת נתוני רווח והפסד נכשלה. הרץ הערכות כדי ליצור היסטוריית בדיקות." |

**Files involved (Pillar 5.3):**
- Add reusable skeleton components (e.g. table rows, chart placeholder) and use them in PnlTerminal, insights, and backtest for a more polished loading experience.

---

## Pillar 6: Accessibility (a11y)

### 6.1 Contrast & Vision (WCAG)

| Check | Status | Details |
|-------|--------|---------|
| **Focus ring** | ✅ **PASS** | `app/globals.css`: `button:focus-visible`, `a:focus-visible`, `input:focus-visible`, etc. get a 2px inner + 4px amber ring; high visibility for keyboard users. |
| **Profit/Loss (color + meaning)** | ✅ **PASS** | PnlTerminal and tables: PnL values use both color (`text-emerald-400` / `text-rose-500`) and explicit +/- in text (e.g. `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`). Screen reader and color-blind users get meaning from sign and labels. |
| **Dark theme contrast** | ⚠️ **ASSUMED** | Backgrounds `#050505`, `#111111`; text `zinc-100`, `white`; amber for accent. Not formally measured; recommend validating that body text and critical UI meet WCAG AA (e.g. 4.5:1 for normal text, 3:1 for large). |
| **Reduced motion** | ✅ **PASS** | `@media (prefers-reduced-motion: reduce)` disables ticker animation. |

**Files involved (Pillar 6.1):**
- Run contrast checker (e.g. axe or manual) on key screens; fix any failing combinations.

---

### 6.2 Semantic HTML & ARIA

| Check | Status | Details |
|-------|--------|---------|
| **Landmarks & roles** | ✅ **PASS** | Footer: `role="contentinfo"`, `aria-label="תנאים משפטיים והבהרות"`. Nav: `role="navigation"`, `aria-label="ניווט ראשי"`. Scanner: `aria-label="סטטוס מערכת — סורק השוק"`. Ticker: `role="region"`, `aria-label="Crypto ticker stream"`. Sections on settings use `aria-label`. |
| **Switch (scanner)** | ✅ **PASS** | Scanner toggle: `role="switch"`, `aria-checked={active}`, `aria-label` for on/off. |
| **Status & live regions** | ✅ **PASS** | Scanner status: `role="status"`. TriggerRetrospectiveButton and EvaluatePredictionsButton: `role="status"`, `aria-live="polite"` for result. CryptoAnalyzer: `aria-live="polite"` for sim error; loading buttons use `aria-busy`. |
| **Form controls** | ✅ **PASS** | Leverage range/select: `aria-labelledby="leverage-label"`. SymbolSelect: `aria-haspopup="listbox"`, `aria-expanded`, `role="listbox"` / `role="option"`, `aria-selected`. Inputs have `aria-label` (e.g. "חיפוש מטבע", "סכום לרכישה או מכירה ב-USD"). |
| **Decorative icons** | ✅ **PASS** | Lucide icons used for visual only have `aria-hidden` where audited. |

**Files involved (Pillar 6.2):** None critical.

---

### 6.3 Keyboard Navigation

| Check | Status | Details |
|-------|--------|---------|
| **Tab order** | ✅ **PASS** | No `tabIndex` hacks that would break natural order. SymbolSelect honeypot uses `tabIndex={-1}` to skip. |
| **Focus visible** | ✅ **PASS** | Global focus-visible ring ensures keyboard users see where focus is. |
| **Shortcuts** | ✅ **PASS** | CryptoAnalyzer: Ctrl+Enter to run analysis, Alt+E to evaluate; `event.preventDefault()` so they don’t conflict with browser. |
| **Full flow by keyboard** | ⚠️ **ASSUMED** | No explicit skip link ("Skip to main content"). Bottom nav and header links are focusable; modal/dialog usage is limited. Recommend a quick pass: Tab through login → dashboard → scanner toggle → symbol select → analyze → simulation buy/sell to confirm no trap and that all actions are reachable. |

**Files involved (Pillar 6.3):**
- Optional: add a "דלג לתוכן ראשי" (skip to main content) link at top of body for screen reader and keyboard users.

---

## Pillar 7: Legal, Compliance & Safety

### 7.1 Existence & Routing of Legal Pages

| Check | Status | Details |
|-------|--------|---------|
| **Terms of Service (תקנון שימוש)** | ⚠️ **PLACEHOLDER** | `app/terms/page.tsx` exists; title "תנאי שימוש", meta description. Content: single paragraph placeholder: "דף תנאי השימוש יופיע כאן. זהו placeholder עד לעדכון המשפטי הסופי." and link "חזרה לדף הבית". Not production-ready. |
| **Privacy Policy (מדיניות פרטיות)** | ⚠️ **PLACEHOLDER** | `app/privacy/page.tsx` exists; title "מדיניות פרטיות". Same pattern: placeholder text and link home. Not production-ready. |
| **Risk Disclaimer (אזהרת סיכון פיננסי)** | ❌ **FAIL** | No dedicated route (e.g. `/risk` or `/disclaimer`). Footer `LegalDisclaimer.tsx` contains inline disclaimer text (AI for education/simulation only; not investment advice; crypto trading involves high risk) but there is no standalone "אזהרת סיכון" page. For a trading/simulation product, a clear risk-disclaimer page is recommended and often required. |
| **Footer links** | ✅ **PASS** | `LegalDisclaimer.tsx`: nav with `aria-label="קישורים משפטיים"`; links to `/terms` (תנאי שימוש) and `/privacy` (מדיניות פרטיות). No link to a risk-disclaimer page (none exists). |

**Files involved (Pillar 7.1):**
- `app/terms/page.tsx` — replace placeholder with full Terms of Service (or template) before production.
- `app/privacy/page.tsx` — replace placeholder with full Privacy Policy (or template) before production.
- **Add** `app/risk/page.tsx` (or `app/disclaimer/page.tsx`) with a dedicated Financial Risk Disclaimer (אזהרת סיכון פיננסי): high risk of loss, simulation only, no guarantee, etc. Link it from `LegalDisclaimer.tsx` next to Terms and Privacy.

---

### 7.2 Template Structure for Missing Legal Pages

If you add a risk-disclaimer page, suggested structure:

- **Route:** `/risk` or `/disclaimer`.
- **Title (meta):** "אזהרת סיכון פיננסי | Mon Chéri Quant AI".
- **Content sections:** (1) Purpose (simulation/education only); (2) No investment advice; (3) High risk of loss in crypto; (4) No guarantee of results; (5) You are solely responsible for decisions; (6) Contact or support link. All in Hebrew, RTL.
- **Footer:** Add a third link in `LegalDisclaimer.tsx`, e.g. "אזהרת סיכון" → `/risk`.

---

## Pillar 8: User Journey & Edge-Case UX

### 8.1 Core Flows (Telegram → Scanner → Simulation → Wallet)

| Flow | Status | Details |
|------|--------|---------|
| **1. Telegram setup** | ✅ **PASS** | Settings page (admin): SettingsTelegramCard with Token + Chat ID inputs, "בדוק חיבור טלגרם" button. Status and connection feedback via aria and UI. User can configure and test. |
| **2. Scanner activation** | ⚠️ **PARTIAL** | ScannerControlPanel: toggle to turn scanner on/off. **FAIL:** On POST success, local state updates (toggle and status); on POST failure (network/500), no toast or inline message — user only sees that the toggle didn’t change, with no explanation. |
| **3. Simulated trade execution** | ⚠️ **PARTIAL** | CryptoAnalyzer: Buy/Sell with amount; `addTrade()` from context; success updates wallet and list; failure shows inline `simError` (INSUFFICIENT_FUNDS, INSUFFICIENT_ASSET, PERSISTENCE_FAILED) in red with `role="status"` and `aria-live="polite"`. **FAIL:** No success toast — user must notice wallet/position change. Optional but recommended: brief success toast or confirmation. |
| **4. Wallet / PnL updates** | ✅ **PASS** | SimulationContext hydrates from API; after addTrade success, state updates so wallet and trade list reflect the new trade. PnlTerminal fetches `/api/simulation/summary` and refreshes when `tradesSignature` changes. |

**Files involved (Pillar 8.1):**
- `components/ScannerControlPanel.tsx` — on POST failure, show inline error or toast (e.g. "לא ניתן לעדכן את הסורק. נסה שוב.").
- `context/SimulationContext.tsx` or CryptoAnalyzer — optional: show short success feedback (toast or inline "העסקה נוספה") after successful addTrade.

---

### 8.2 Friction Points & Dead Ends

| Check | Status | Details |
|-------|--------|---------|
| **Success feedback** | ⚠️ **PARTIAL** | TriggerRetrospectiveButton: has local toast (success/error). Scanner toggle: no success message. Simulated trade: no success toast; only inline error on failure. EvaluatePredictionsButton: status message. Inconsistent pattern. |
| **Error feedback** | ⚠️ **PARTIAL** | Simulation: `simError` shown inline. Scanner: no error message on failed toggle. Login: returns JSON error; ensure login page displays it (e.g. "Invalid credentials"). |
| **Dead ends** | ✅ **PASS** | Terms/Privacy have "חזרה לדף הבית". Error pages (error.tsx, global-error.tsx) offer retry or navigation. No audited flow leaves user without a way back. |
| **Reset simulation** | ✅ **PASS** | CryptoAnalyzer: "איפוס ארנק סימולציה" calls `resetSimulation()`; context clears state and POSTs reset; no confirmation dialog — acceptable for simulation; consider optional "Are you sure?" for production. |

**Files involved (Pillar 8.2):**
- ScannerControlPanel: add error (and optionally success) feedback.
- Consider a small, app-wide toast system (or reuse TriggerRetrospectiveButton-style inline toast) for scanner and simulation actions.

---

## Summary (Pillars 5–8)

| Pillar | Pass | Partial / Minor | Fail |
|--------|------|------------------|------|
| **5. UI/UX & RTL** | 10 | 4 | 1 |
| **6. Accessibility** | 8 | 2 | 0 |
| **7. Legal & Compliance** | 1 | 2 | 1 |
| **8. User Journey & UX** | 4 | 3 | 0 |

**Critical before production (Pillars 5–8):**
1. **Legal:** Replace Terms and Privacy placeholders with real content (or approved templates); add a dedicated Risk Disclaimer page and link it in the footer.
2. **Scanner toggle:** Show error (and optionally success) feedback when POST fails or succeeds.
3. **Loading:** Add skeleton or consistent loading states for data-heavy views (e.g. PnlTerminal, insights).
4. **RTL/Charts:** Optional — ticker direction and chart axis RTL if product requires it.

---

## Full Audit Summary (All 8 Pillars)

| Pillar | Pass | Partial / Minor | Fail |
|--------|------|------------------|------|
| 1. Backend & Data Integrity | 6 | 4 | 3 |
| 2. Security & Auth | 6 | 2 | 2 |
| 3. Performance | 5 | 3 | 0 |
| 4. Financial Math & Trading | 5 | 2 | 3 |
| 5. UI/UX & RTL | 10 | 4 | 1 |
| 6. Accessibility | 8 | 2 | 0 |
| 7. Legal & Compliance | 1 | 2 | 1 |
| 8. User Journey & UX | 4 | 3 | 0 |

**Highest priority before production:**  
Backend (cron try/catch, simulation validation, timeouts), Security (rate limiting, Telegram cap), Financial (Decimal in virtual portfolio, server-side trade validation), Legal (Terms, Privacy, Risk Disclaimer page + footer link), and UX (scanner feedback, optional success toasts, loading skeletons).
