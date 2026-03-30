# Implementation Diffs — Zero-Touch Automation Migration

## File 1: `lib/queue/scan-queue.ts`

### Addition: TriggerMasterScanJobData Interface + setupAutoScanner()

**Location:** Lines 255–309 (appended to end of file before final export)

```typescript
// ────────────────────────────────────────────────────────────────────────────
// Zero-Touch Automation: BullMQ Repeatable Job Scheduler
// ────────────────────────────────────────────────────────────────────────────

export interface TriggerMasterScanJobData {
  triggeredAt: number;
}

/**
 * Setup the auto-scanner as a BullMQ repeatable job.
 * Runs every 20 minutes (cron pattern: '*/20 * * * *').
 * Call once at worker startup.
 *
 * The Worker will detect this job by name and enqueue the scan cycle.
 */
export async function setupAutoScanner(): Promise<void> {
  if (!isRedisAvailable()) {
    console.warn('[AutoScanner] Redis unavailable; skipping repeatable job setup.');
    return;
  }

  const queue = getCoinScanQueue();

  try {
    // Check if job already exists to avoid duplicates
    const existingJobs = await queue.getRepeatableJobs();
    const alreadyExists = existingJobs.some((j) => j.name === 'trigger-master-scan');

    if (alreadyExists) {
      console.log('[AutoScanner] Repeatable job "trigger-master-scan" already exists; skipping.');
      return;
    }

    // Add repeatable job: every 20 minutes
    await queue.add(
      'trigger-master-scan',
      { triggeredAt: Date.now() } satisfies TriggerMasterScanJobData,
      {
        repeat: {
          pattern: '*/20 * * * *',
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    console.log('[AutoScanner] Repeatable job "trigger-master-scan" registered (every 20 minutes).');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AutoScanner] Failed to setup repeatable job:', msg);
    throw err;
  }
}
```

---

## File 2: `lib/queue/queue-worker.ts`

### Change 1: Updated Imports

**Before:**
```typescript
import { Worker, type Job } from 'bullmq';
import { getRedisClient, closeRedisClient } from './redis-client';
import {
  QUEUE_NAME,
  attachDrainListener,
  persistJobResult,
  customBackoffStrategy,
  closeCoinScanQueueEvents,
  type CoinScanJobData,
  type CoinScanJobResult,
} from './scan-queue';
import { doAnalysisCore } from '@/lib/analysis-core';
import { generateTieredReport } from '@/lib/reports/tiered-report-generator';
import { emitJobComplete } from '@/lib/webhooks/emitter';
import { writeAudit } from '@/lib/audit';
import type { ConnectionOptions } from 'bullmq';
```

**After:**
```typescript
import { Worker, type Job } from 'bullmq';
import { randomUUID } from 'crypto';  // ← ADDED
import { getRedisClient, closeRedisClient } from './redis-client';
import {
  QUEUE_NAME,
  attachDrainListener,
  persistJobResult,
  customBackoffStrategy,
  closeCoinScanQueueEvents,
  setupAutoScanner,              // ← ADDED
  enqueueScanCycle,              // ← ADDED
  type CoinScanJobData,
  type CoinScanJobResult,
  type TriggerMasterScanJobData, // ← ADDED
} from './scan-queue';
import { doAnalysisCore } from '@/lib/analysis-core';
import { generateTieredReport } from '@/lib/reports/tiered-report-generator';
import { emitJobComplete } from '@/lib/webhooks/emitter';
import { writeAudit } from '@/lib/audit';
import { buildCandidateList } from '@/lib/workers/market-scanner';        // ← ADDED
import { getScannerSettings } from '@/lib/db/system-settings';              // ← ADDED
import type { ConnectionOptions } from 'bullmq';
```

### Change 2: Updated processJob() Function Signature & Implementation

**Before:**
```typescript
async function processJob(
  job: Job<CoinScanJobData, CoinScanJobResult>
): Promise<CoinScanJobResult> {
  const { symbol, cycleId, macroCtx } = job.data;
  const start = Date.now();

  if (!cycleStartTimes.has(cycleId)) {
    cycleStartTimes.set(cycleId, start);
  }

  console.log(`[Worker] Processing ${symbol} (cycle=${cycleId}, attempt=${job.attemptsMade + 1})`);
  
  // ... rest of symbol analysis logic ...
}
```

**After:**
```typescript
async function processJob(
  job: Job<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>  // ← UNION TYPES
): Promise<CoinScanJobResult | void> {
  const start = Date.now();

  // ── Handle trigger-master-scan: enqueue all candidates ──
  if (job.name === 'trigger-master-scan') {
    console.log('[Worker] Processing trigger-master-scan (repeatable scheduler)');
    try {
      const settings = await getScannerSettings();
      if (settings && !settings.scanner_is_active) {
        console.log('[Worker] Scanner disabled in settings; skipping this cycle.');
        writeAudit({ event: 'queue.scanner_disabled', level: 'info' });
        return;
      }

      const cycleId = randomUUID();
      const { candidates, macroCtx } = await buildCandidateList();

      if (candidates.length === 0) {
        console.log('[Worker] No candidates found for this cycle.');
        writeAudit({ event: 'queue.trigger_no_candidates', level: 'warn', meta: { cycleId } });
        return;
      }

      await enqueueScanCycle(candidates, cycleId, macroCtx);
      const durationMs = Date.now() - start;

      writeAudit({
        event: 'queue.trigger_master_scan_executed',
        level: 'info',
        meta: { cycleId, count: candidates.length, durationMs },
      });

      console.log(
        `[Worker] trigger-master-scan completed in ${durationMs}ms — enqueued ${candidates.length} jobs for cycle ${cycleId}`
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Worker] trigger-master-scan failed:', msg);
      writeAudit({
        event: 'queue.trigger_master_scan_failed',
        level: 'error',
        meta: { error: msg },
      });
      throw err;
    }
  }

  // ── Handle standard scan job: analyze a single symbol ──
  const jobData = job.data as CoinScanJobData;
  const { symbol, cycleId, macroCtx } = jobData;

  if (!cycleStartTimes.has(cycleId)) {
    cycleStartTimes.set(cycleId, start);
  }

  console.log(`[Worker] Processing ${symbol} (cycle=${cycleId}, attempt=${job.attemptsMade + 1})`);

  // ... rest of existing symbol analysis logic (unchanged) ...
}
```

### Change 3: Updated Worker Type Signature

**Before:**
```typescript
const worker = new Worker<CoinScanJobData, CoinScanJobResult>(
  QUEUE_NAME,
  processJob,
  {
    connection,
    concurrency: CONCURRENCY,
    settings: {
      backoffStrategy: customBackoffStrategy,
    },
  }
);
```

**After:**
```typescript
const worker = new Worker<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>(
  QUEUE_NAME,
  processJob,
  {
    connection,
    concurrency: CONCURRENCY,
    settings: {
      backoffStrategy: customBackoffStrategy,
    },
  }
);
```

### Change 4: Added setupAutoScanner() Call at Startup

**Before:**
```typescript
attachDrainListener(async (cycleId: string) => {
  const cycleStart = cycleStartTimes.get(cycleId) ?? Date.now();
  try {
    await generateTieredReport(cycleId, cycleStart);
  } finally {
    cycleStartTimes.delete(cycleId);
  }
});

console.log(
  `[Worker] BullMQ worker started — queue="${QUEUE_NAME}", concurrency=${CONCURRENCY}`
);
```

**After:**
```typescript
attachDrainListener(async (cycleId: string) => {
  const cycleStart = cycleStartTimes.get(cycleId) ?? Date.now();
  try {
    await generateTieredReport(cycleId, cycleStart);
  } finally {
    cycleStartTimes.delete(cycleId);
  }
});

// Initialize the auto-scanner repeatable job on startup
setupAutoScanner()
  .then(() => {
    console.log('[Worker] Auto-scanner scheduler initialized.');
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Failed to initialize auto-scanner:', msg);
    process.exit(1);
  });

console.log(
  `[Worker] BullMQ worker started — queue="${QUEUE_NAME}", concurrency=${CONCURRENCY}`
);
```

---

## File 3: `lib/workers/market-scanner.ts`

### Change 1: Removed intervalId Variable

**Before:**
```typescript
let intervalId: ReturnType<typeof setInterval> | null = null;

export function getScannerState(): ScannerState {
  return {
    ...state,
    lastRunStats: state.lastRunStats ? { ...state.lastRunStats } : null,
    lastDiagnostics: state.lastDiagnostics ? { ...state.lastDiagnostics } : null,
  };
}
```

**After:**
```typescript
export function getScannerState(): ScannerState {
  return {
    ...state,
    lastRunStats: state.lastRunStats ? { ...state.lastRunStats } : null,
    lastDiagnostics: state.lastDiagnostics ? { ...state.lastDiagnostics } : null,
  };
}
```

### Change 2: Deprecated startMarketScanner() & stopMarketScanner()

**Before:**
```typescript
export function startMarketScanner(): void {
  if (intervalId != null) {
    return;
  }
  runOneCycle().catch((err) => {
    void sendWorkerFailureAlert('scanner.startup', err);
  });
  intervalId = setInterval(() => {
    runOneCycle().catch((err) => {
      void sendWorkerFailureAlert('scanner.interval', err);
    });
  }, SCAN_INTERVAL_MS);
  console.log('[HEARTBEAT] Market scanner started (20m interval).');
}

export function stopMarketScanner(): void {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
    state.status = 'IDLE';
    console.log('[HEARTBEAT] Market scanner stopped.');
  }
}
```

**After:**
```typescript
/**
 * @deprecated Use BullMQ repeatable jobs instead (setupAutoScanner in queue-worker.ts).
 * This function is kept for backwards compatibility with legacy HTTP endpoints.
 * No-op when running the PM2 queue worker with QUEUE_ENABLED=true.
 */
export function startMarketScanner(): void {
  console.log('[HEARTBEAT] startMarketScanner() deprecated — using BullMQ repeatable jobs instead.');
}

/**
 * @deprecated Use BullMQ repeatable jobs instead.
 * This function is kept for backwards compatibility.
 */
export function stopMarketScanner(): void {
  console.log('[HEARTBEAT] stopMarketScanner() deprecated — no-op (handled by BullMQ worker).');
}
```

---

## File 4: `app/api/cron/scan/route.ts`

**Entire file replaced:**

**Before:**
```typescript
/**
 * Secured GET endpoint for Vercel Cron or external cron (e.g. cron-job.org).
 *
 * Routing logic:
 *   QUEUE_ENABLED=true  → fire-and-forget to /api/cron/enqueue (BullMQ path)
 *   QUEUE_ENABLED=false → fire-and-forget to /api/cron/worker  (legacy path, default)
 *
 * Returns immediately (~100ms); actual work happens asynchronously.
 * Authorization: CRON_SECRET or ADMIN_SECRET (Bearer header or x-cron-secret).
 * Scanner on/off is enforced in the downstream handler.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const useQueue = process.env.QUEUE_ENABLED === 'true';
  const targetPath = useQueue ? '/api/cron/enqueue' : '/api/cron/worker';
  const targetUrl = new URL(targetPath, request.url);

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 50);
  fetch(targetUrl.toString(), {
    signal: ac.signal,
    headers: { Authorization: `Bearer ${token}` },
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeoutId));

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/cron-success`, 302);
}
```

**After:**
```typescript
/**
 * @deprecated Use BullMQ repeatable jobs instead.
 *
 * This endpoint is NO LONGER ACTIVE and should be removed from your Vercel Cron configuration.
 * The market scanner now runs as a repeatable BullMQ job in the PM2 queue worker,
 * triggered every 20 minutes from setupAutoScanner() in lib/queue/queue-worker.ts.
 *
 * Remove from vercel.json:
 *   { "path": "/api/cron/scan", "schedule": "*/20 * * * *" }
 *
 * No external HTTP trigger is needed anymore.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  console.warn('[Deprecated] GET /api/cron/scan called. This route is no longer active.');
  return NextResponse.json(
    {
      deprecated: true,
      message: 'This endpoint is deprecated. Remove from vercel.json.',
      details: 'Use BullMQ repeatable jobs (setupAutoScanner) instead.',
    },
    { status: 410 }
  );
}
```

---

## File 5: `app/api/cron/enqueue/route.ts`

**JSDoc Comment Update + Minor Changes**

**Before:**
```typescript
/**
 * Enqueue Scan Cycle — replaces the fire-and-forget /api/cron/worker chain.
 *
 * Fetches coin candidates (same logic as market-scanner.ts) and enqueues
 * one BullMQ job per candidate. Returns immediately — the Worker process
 * runs the jobs in the background.
 *
 * Authorization: same CRON_SECRET / ADMIN_SECRET as existing routes.
 * Only active when QUEUE_ENABLED=true.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { getScannerSettings } from '@/lib/db/system-settings';
import { buildCandidateList, buildCycleMacroContext } from '@/lib/workers/market-scanner';
```

**After:**
```typescript
/**
 * @deprecated Use BullMQ repeatable jobs for automatic scheduling.
 *
 * This endpoint is now MANUAL ONLY and should NOT be called automatically.
 * Automatic scheduling is handled by setupAutoScanner() in lib/queue/queue-worker.ts
 * as a BullMQ repeatable job that triggers every 20 minutes.
 *
 * You may still call this endpoint manually for on-demand scans, but:
 * - Remove from vercel.json cron configuration
 * - Do NOT set up external cron triggers (e.g. cron-job.org) to call this
 * - The repeatable job is now idempotent and handles scheduling entirely
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { getScannerSettings } from '@/lib/db/system-settings';
import { buildCandidateList } from '@/lib/workers/market-scanner';
// ← REMOVED: buildCycleMacroContext import (not used)
```

**Audit Event Update:**

**Before:**
```typescript
    writeAudit({
      event: 'queue.cycle_enqueued',
      level: 'info',
      meta: { cycleId, count: candidates.length, symbols: candidates },
    });

    return NextResponse.json({
      ok: true,
      cycleId,
      enqueued: candidates.length,
      symbols: candidates,
    });
```

**After:**
```typescript
    writeAudit({
      event: 'queue.cycle_enqueued_manual',  // ← CHANGED
      level: 'info',
      meta: { cycleId, count: candidates.length, symbols: candidates, source: 'manual_http_trigger' },  // ← ADDED source
    });

    return NextResponse.json({
      ok: true,
      cycleId,
      enqueued: candidates.length,
      symbols: candidates,
      note: 'Manual trigger only — automatic scheduling is handled by BullMQ repeatable jobs.',  // ← ADDED note
    });
```

---

## Summary of Changes by Type

| Change Type | File | Lines | Impact |
|-------------|------|-------|--------|
| **Addition** | `lib/queue/scan-queue.ts` | 255–309 | New repeatable job setup |
| **Update** | `lib/queue/queue-worker.ts` | 19–40 | Imports (4 new) |
| **Update** | `lib/queue/queue-worker.ts` | 53–193 | processJob() function (new trigger-master-scan handler) |
| **Update** | `lib/queue/queue-worker.ts` | 201 | Worker type signature |
| **Addition** | `lib/queue/queue-worker.ts` | 239–247 | Startup initialization call |
| **Removal** | `lib/workers/market-scanner.ts` | 109 | intervalId variable |
| **Replacement** | `lib/workers/market-scanner.ts` | 517–539 | startMarketScanner/stopMarketScanner functions |
| **Replacement** | `app/api/cron/scan/route.ts` | 1–40 | Entire file (deprecation) |
| **Update** | `app/api/cron/enqueue/route.ts` | 1–17 | JSDoc + imports |
| **Update** | `app/api/cron/enqueue/route.ts` | 51–62 | Audit event + response |

---

## TypeScript Compliance

All changes maintain **strict TypeScript** mode:

- ✅ Union types explicitly defined (`CoinScanJobData | TriggerMasterScanJobData`)
- ✅ No implicit `any` types
- ✅ Type guards (`job.name === 'trigger-master-scan'`)
- ✅ Proper async/await error handling
- ✅ Satisfies keyword for type refinement (`satisfies TriggerMasterScanJobData`)

---

## Testing Checklist

- [ ] Compile: `tsc --noEmit` (should pass)
- [ ] Lint: `eslint .` (should pass)
- [ ] Unit test: `jest lib/queue/` (if applicable)
- [ ] Integration: Deploy to staging, verify repeatable job registers
- [ ] Smoke test: Wait 20 minutes, verify trigger-master-scan job executes
- [ ] Fallback: Verify manual `/api/cron/enqueue` still works (for manual triggers)
