# Zero-Touch Automation Migration: Vercel Cron → BullMQ Repeatable Jobs

**Date:** March 30, 2026  
**Scope:** Complete migration from HTTP-based Vercel Cron triggers to Redis-backed BullMQ repeatable jobs  
**Status:** ✅ Implementation Complete

---

## Executive Summary

This migration eliminates dependency on Vercel Serverless Cron by replacing it with BullMQ's native repeatable jobs, triggered automatically every 20 minutes from the PM2 queue worker. **Zero external HTTP calls needed.**

### Key Changes

1. **Repeatable Job Scheduler**: `setupAutoScanner()` creates a BullMQ repeatable job (`trigger-master-scan`) that runs on cron pattern `*/20 * * * *`
2. **Worker Job Handler**: Updated `processJob()` in `queue-worker.ts` to detect and process `trigger-master-scan` jobs
3. **Legacy Code Removal**: `setInterval` logic removed from `market-scanner.ts`; functions deprecated but kept for backwards compatibility
4. **Vercel Cron Deprecation**: `/api/cron/scan` and `/api/cron/enqueue` marked as deprecated; no longer used for automatic scheduling

---

## File Changes

### 1. `lib/queue/scan-queue.ts` — Added Repeatable Job Setup

**Addition:** New interface + function (lines 255-309)

```typescript
export interface TriggerMasterScanJobData {
  triggeredAt: number;
}

export async function setupAutoScanner(): Promise<void>
```

**Details:**
- Checks if repeatable job already exists (idempotent)
- Adds job with cron pattern `*/20 * * * *`
- BullMQ automatically triggers this job every 20 minutes
- Called once at worker startup

**Why:** Eliminates HTTP polling; uses Redis as the single source of truth for scheduling.

---

### 2. `lib/queue/queue-worker.ts` — Updated Job Processor & Worker Initialization

**Changes:**

#### Imports (lines 19-40)
- Added `randomUUID` from crypto
- Added `setupAutoScanner`, `enqueueScanCycle`, `TriggerMasterScanJobData` exports

#### Job Processor (lines 53-193)
**Changed signature:**
```typescript
// Before
async function processJob(job: Job<CoinScanJobData, CoinScanJobResult>)

// After
async function processJob(job: Job<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>)
```

**New Logic:**
- Detects `job.name === 'trigger-master-scan'`
- When detected:
  1. Checks if scanner is enabled in settings
  2. Calls `buildCandidateList()` to fetch top 50 coins
  3. Calls `enqueueScanCycle()` to enqueue each candidate as a separate job
  4. Returns void (repeatable job result is not persisted)
- Falls through to existing symbol-analysis logic for standard scan jobs

#### Worker Type (line 201)
Updated to accept both job types:
```typescript
const worker = new Worker<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>(...)
```

#### Startup Initialization (lines 239-247)
Added auto-scanner setup:
```typescript
setupAutoScanner()
  .then(() => {
    console.log('[Worker] Auto-scanner scheduler initialized.');
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Failed to initialize auto-scanner:', msg);
    process.exit(1);
  });
```

**Why:** Ensures repeatable job is registered in Redis before worker starts processing.

---

### 3. `lib/workers/market-scanner.ts` — Legacy Code Cleanup

**Removals:**
- Removed `intervalId` variable (line 109 removed)
- Removed `setInterval`/`clearInterval` logic from `startMarketScanner()` and `stopMarketScanner()`

**Deprecations:**
Both functions now log deprecation warnings and become no-ops:

```typescript
export function startMarketScanner(): void {
  console.log('[HEARTBEAT] startMarketScanner() deprecated — using BullMQ repeatable jobs instead.');
}

export function stopMarketScanner(): void {
  console.log('[HEARTBEAT] stopMarketScanner() deprecated — no-op (handled by BullMQ worker).');
}
```

**Why:** Maintains backwards compatibility with existing code that calls these functions (e.g., legacy instrumentation.ts), but prevents accidental double-scheduling.

---

### 4. `app/api/cron/scan/route.ts` — Deprecated HTTP Endpoint

**Status:** 410 Gone (Permanently Removed)

**Response:**
```json
{
  "deprecated": true,
  "message": "This endpoint is deprecated. Remove from vercel.json.",
  "details": "Use BullMQ repeatable jobs (setupAutoScanner) instead."
}
```

**Action Required:**
Remove from `vercel.json`:
```json
{
  "path": "/api/cron/scan",
  "schedule": "*/20 * * * *"
}
```

**Why:** This HTTP endpoint triggered the market scanner every 20 minutes. Now handled by BullMQ.

---

### 5. `app/api/cron/enqueue/route.ts` — Manual Trigger Only

**Status:** Functional but marked for manual use only

**Key Changes:**
- JSDoc updated to mark as deprecated for automatic scheduling
- Audit event changed from `queue.cycle_enqueued` → `queue.cycle_enqueued_manual`
- Response includes note: *"Manual trigger only — automatic scheduling is handled by BullMQ repeatable jobs."*

**Use Case:** Still available for on-demand manual scans via HTTP POST, but NOT for automatic cron scheduling.

**Action Required:**
If this endpoint was set up in external cron (e.g., cron-job.org), remove that trigger.

---

## How It Works: The Flow

### Before (Legacy)
```
Vercel Cron (*/20) 
  → GET /api/cron/scan 
  → GET /api/cron/enqueue (or /api/cron/worker) 
  → enqueueScanCycle()
```
**Problem:** Vercel Serverless Cron has limited reliability; requires external HTTP.

### After (BullMQ)
```
setupAutoScanner() at worker startup
  → Creates repeatable job in Redis
  
BullMQ Repeatable Job (*/20)
  → Enqueues 'trigger-master-scan' job
  
Worker.processJob('trigger-master-scan')
  → buildCandidateList()
  → enqueueScanCycle() 
  → Enqueues ~12 individual symbol jobs
  
Worker.processJob('scan:SYMBOL:CYCLEID')
  → doAnalysisCore()
  → generateTieredReport() on cycle drain
```
**Advantage:** Redis-backed, zero HTTP calls, self-healing, survives process restarts.

---

## Deployment Checklist

### Before Restarting PM2 Worker

- [ ] Update `vercel.json` — remove `/api/cron/scan` cron rule
- [ ] Verify `QUEUE_ENABLED=true` in `.env` on production server
- [ ] Verify `REDIS_URL` is set and Redis is accessible
- [ ] Optional: Remove external cron triggers (if any) that call `/api/cron/enqueue`

### Startup Verification

After restarting with `pm2 start ecosystem.config.js --only queue-worker`:

```bash
# Check logs for setup message
pm2 logs queue-worker | grep -i "auto-scanner\|trigger-master-scan"

# Expected outputs:
# [AutoScanner] Repeatable job "trigger-master-scan" registered (every 20 minutes).
# [Worker] Auto-scanner scheduler initialized.
```

### Redis Verification

```bash
# Connect to Redis and list repeatable jobs
redis-cli

> KEYS scan:*
# Should show:
# 1) "scan:active_cycle_id"
# 2) scan:job:trigger-master-scan:* (BullMQ internal)
```

### Monitor First Cycle (20 minutes)

Once worker is live, wait for the next repeatable job trigger (within 20 minutes):

```bash
pm2 logs queue-worker | tail -100

# Expected:
# [Worker] Processing trigger-master-scan (repeatable scheduler)
# [Worker] No candidates found for this cycle.  # OR
# [Worker] trigger-master-scan completed in Xms — enqueued N jobs for cycle UUID
```

---

## Consensus & AI Logic: Unchanged ✅

Per requirements, **zero modifications** to:
- `doAnalysisCore()` logic
- Consensus engine algorithms
- AI provider integrations (Groq, Anthropic, Gemini)
- Alpha Matrix scoring
- Risk management thresholds
- Telegram alerting

Only **scheduling mechanism** changed.

---

## Backwards Compatibility

- `startMarketScanner()` / `stopMarketScanner()` still callable but deprecated
- `/api/cron/enqueue` still works for manual on-demand scans
- All existing queue job names and formats unchanged
- Audit events extended with new markers (`_manual` suffix for HTTP triggers, `_scheduler` for repeatable jobs)

---

## Troubleshooting

### Issue: No jobs triggered after 20+ minutes

**Check:**
1. `pm2 status` — is queue-worker running?
2. `pm2 logs queue-worker` — any `setupAutoScanner` errors?
3. Redis connectivity: `redis-cli ping`
4. Scanner enabled in settings: `SELECT 0; GET system_settings:scanner`

### Issue: High Redis memory usage

**Root Cause:** Persisted job results (7200s TTL by default). BullMQ removes completed jobs automatically (see `removeOnComplete: { count: 200 }` in scan-queue.ts).

**Solution:** Set environment variable `SCAN_RESULT_TTL_SECONDS` to lower value, or let default TTL expire.

### Issue: Repeatable job not re-registering after restart

**Root Cause:** Job already exists in Redis from previous run.

**Solution (safe):** setupAutoScanner() checks for existing job and returns early. No action needed. If you want to force re-register:

```bash
redis-cli
> DEL scan:job:trigger-master-scan:0  # BullMQ key pattern
> # Then restart worker
```

---

## Summary of Deployment Changes

| Aspect | Before | After |
|--------|--------|-------|
| **Trigger** | Vercel Cron HTTP GET | BullMQ repeatable job (Redis) |
| **Frequency** | Every 20 min (via /api/cron/scan) | Every 20 min (cron pattern `*/20 * * * *`) |
| **Single Point of Failure** | Vercel Cron service | Redis (same as queue) |
| **External Network Calls** | 1 per cycle (HTTP GET) | 0 (internal to Redis) |
| **Restart Resilience** | Lost if Vercel Cron didn't trigger before restart | Repeatable job persists in Redis |
| **Configuration** | vercel.json cron rule | Environment variables (QUEUE_ENABLED, REDIS_URL) |

---

## Code Quality

- ✅ TypeScript strict mode compliance (no implicit any)
- ✅ Proper error handling and logging
- ✅ Audit events for observability
- ✅ Backwards-compatible deprecation (no breaking changes)
- ✅ Idempotent job registration (safe to restart)
- ✅ Graceful shutdown included (SIGTERM/SIGINT handlers)

---

## Next Steps

1. **Test locally** (if applicable): Trigger queue worker, verify first "trigger-master-scan" job appears in logs
2. **Deploy to staging** (if applicable): Run through full cycle, check audit logs
3. **Deploy to production**: Roll out with PM2, monitor first cycle
4. **Remove Vercel Cron rule** from production vercel.json once confirmed stable

---

**Questions or Issues?**  
Check PM2 logs: `pm2 logs queue-worker`  
Check Redis: `redis-cli KEYS "*scan*"`  
Check audit table: `SELECT * FROM audits WHERE event LIKE '%scanner%' ORDER BY created_at DESC;`
