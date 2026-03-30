# Architecture Flow: Zero-Touch Automation

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PM2 Queue Worker Process                         │
│                      (Dedicated VPS, self-managed)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                       Worker Startup                               │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ 1. queue-worker.ts starts                                         │ │
│  │ 2. Connects to Redis (getRedisClient)                             │ │
│  │ 3. Creates BullMQ Worker instance                                 │ │
│  │ 4. Calls setupAutoScanner()                                       │ │
│  │    └─→ Registers 'trigger-master-scan' as repeatable job          │ │
│  │    └─→ Cron pattern: '*/20 * * * *' (every 20 minutes)           │ │
│  │ 5. Waits for jobs in queue                                        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                  Redis (Shared Instance)                          │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │  Queue: coin-scan                                                 │ │
│  │  ├─ Repeatable Jobs: trigger-master-scan (*/20)                   │ │
│  │  ├─ Waiting Jobs: scan:BTCUSDT:CYCLE-ID, scan:ETHUSDT:CYCLE-ID   │ │
│  │  └─ Results Cache: scan:result:CYCLE-ID:SYMBOL                   │ │
│  │                                                                   │ │
│  │  Schema:                                                          │ │
│  │  └─ bull:coin-scan:repeat:trigger-master-scan:0 (repeatable)     │ │
│  │  └─ bull:coin-scan:waiting (queue of waiting jobs)               │ │
│  │  └─ bull:coin-scan:active (currently processing)                 │ │
│  │  └─ bull:coin-scan:completed (retention: 200)                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │               Every 20 Minutes: Automatic Trigger                 │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │                                                                   │ │
│  │ ┌─ Time matches cron pattern (*/20) ──────────────────────────┐  │ │
│  │ │ BullMQ automatically creates 'trigger-master-scan' job      │  │ │
│  │ │ Job data: { triggeredAt: Date.now() }                      │  │ │
│  │ └────────────────────────────────────────────────────────────┘  │ │
│  │                           ↓                                     │ │
│  │ ┌─ Worker detects job ──────────────────────────────────────┐  │ │
│  │ │ processJob() called with job.name === 'trigger-master-scan' │ │
│  │ └────────────────────────────────────────────────────────────┘  │ │
│  │                           ↓                                     │ │
│  │ ┌─ Check: Is scanner enabled? ─────────────────────────────┐  │ │
│  │ │ getScannerSettings() → system_settings.scanner_is_active  │  │ │
│  │ │ If disabled: return early (no-op)                         │  │ │
│  │ │ If enabled: continue                                      │  │ │
│  │ └────────────────────────────────────────────────────────────┘  │ │
│  │                           ↓                                     │ │
│  │ ┌─ Build candidate list ────────────────────────────────────┐  │ │
│  │ │ buildCandidateList()                                       │  │ │
│  │ │  1. Fetch app settings (confidence threshold, etc)         │  │ │
│  │ │  2. Get macro pulse (DXY, Fear/Greed, BTC dominance)       │  │ │
│  │ │  3. Get market risk sentiment (volatility, ATR)            │  │ │
│  │ │  4. Get top 50 gems by 24h volume                          │  │
│  │ │  5. Filter: min volume, supported bases, etc               │  │ │
│  │ │  6. Return: candidates array (typically ~12 symbols)       │  │ │
│  │ │                                                             │  │ │
│  │ │ Output:                                                     │  │ │
│  │ │  {                                                          │  │ │
│  │ │    candidates: ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', ...],    │  │ │
│  │ │    macroCtx: { risk, dxy, fearGreed, ... },               │  │ │
│  │ │    appSettings: { ... },                                   │  │ │
│  │ │    confidenceThreshold: 80                                 │  │ │
│  │ │  }                                                          │  │ │
│  │ └────────────────────────────────────────────────────────────┘  │ │
│  │                           ↓                                     │ │
│  │ ┌─ Enqueue cycle ───────────────────────────────────────────┐  │ │
│  │ │ enqueueScanCycle(candidates, cycleId, macroCtx)            │  │ │
│  │ │                                                             │  │ │
│  │ │ For each candidate symbol:                                 │  │ │
│  │ │  ├─ Create job: name='scan:SYMBOL:CYCLEID'                 │  │ │
│  │ │  ├─ Data: { symbol, cycleId, macroCtx, priority }          │  │ │
│  │ │  ├─ Options: jobId=CYCLEID:SYMBOL, priority=index          │  │ │
│  │ │  ├─ Retry: 5 attempts with exponential backoff             │  │ │
│  │ │  └─ Add to queue.waiting                                   │  │ │
│  │ │                                                             │  │ │
│  │ │ Result: 12 jobs in queue.waiting                           │  │ │
│  │ │ Audit: event='queue.trigger_master_scan_executed'          │  │ │
│  │ └────────────────────────────────────────────────────────────┘  │ │
│  │                           ↓                                     │ │
│  │ ┌─ Repeat job completes ────────────────────────────────────┐  │ │
│  │ │ trigger-master-scan job marked complete                   │  │ │
│  │ │ Now worker starts processing symbol analysis jobs          │  │ │
│  │ │ (handled by standard processJob() logic for scan jobs)     │  │ │
│  │ └────────────────────────────────────────────────────────────┘  │ │
│  │                                                                  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              Symbol Analysis (Concurrent, up to 3)              │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │                                                                │ │
│  │ [Worker Thread 1]     [Worker Thread 2]     [Worker Thread 3]  │ │
│  │ Processing BTCUSDT    Processing ETHUSDT    Processing ADAUSDT │ │
│  │       ↓                      ↓                      ↓           │ │
│  │ doAnalysisCore()      doAnalysisCore()      doAnalysisCore()   │ │
│  │       ↓                      ↓                      ↓           │ │
│  │ LLM Consensus:        LLM Consensus:        LLM Consensus:     │ │
│  │ ├─ Groq                ├─ Groq                ├─ Groq          │ │
│  │ ├─ Anthropic           ├─ Anthropic           ├─ Anthropic     │ │
│  │ └─ Gemini              └─ Gemini              └─ Gemini        │ │
│  │       ↓                      ↓                      ↓           │ │
│  │ Persist Result:       Persist Result:       Persist Result:    │ │
│  │ scan:result:CYCLE:BTC scan:result:CYCLE:ETH scan:result:CYC:ADA│ │
│  │  (TTL: 2 hours)        (TTL: 2 hours)        (TTL: 2 hours)   │ │
│  │       ↓                      ↓                      ↓           │ │
│  │ Emit SSE Event        Emit SSE Event        Emit SSE Event    │ │
│  │ job_complete          job_complete          job_complete       │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │          Queue Drain: All Jobs Complete (Drain Event)         │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │                                                                │ │
│  │ waiting = 0 AND active = 0                                    │ │
│  │           ↓                                                    │ │
│  │ QueueEvents fires 'drained' event                             │ │
│  │           ↓                                                    │ │
│  │ attachDrainListener() callback triggers                       │ │
│  │           ↓                                                    │ │
│  │ generateTieredReport(cycleId, cycleStart)                     │ │
│  │  ├─ Fetch all persisted results: scan:result:CYCLE:*          │ │
│  │  ├─ Calculate tiered rankings (Alpha Matrix)                  │ │
│  │  ├─ Store report in Postgres (reports table)                  │ │
│  │  └─ Emit report_generated SSE event                           │ │
│  │                                                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              Cycle Complete, Wait for Next Trigger             │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │ Worker idles, waiting for next job                             │ │
│  │ In ~20 minutes, cron pattern matches again → repeat            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Sequence Diagram: One Cycle

```
Time     Action                          Worker State         Redis State
─────────────────────────────────────────────────────────────────────────
T+00s    Cron matches (*/20)             [idle]              waiting: 0
         └→ BullMQ creates job                                active: 0

T+00s    processJob('trigger-master-scan')  [busy]            waiting: 0
         └→ buildCandidateList()                                active: 1
         └→ Fetch settings, macro, risk
         └→ Get 50 gems by volume

T+02s    buildCandidateList returns       [busy]              waiting: 0
         ├─ candidates: 12 symbols
         ├─ macroCtx: processed
         └─ confidenceThreshold: 80

T+02s    enqueueScanCycle(...)            [busy]              waiting: 0
         └→ Add 12 jobs to queue

T+03s    ✓ trigger-master-scan completes  [idle]              waiting: 12
         └→ Next jobs auto-dequeued                            active: 0

T+03s    processJob('scan:BTC:...')       [busy]              waiting: 11
         processJob('scan:ETH:...')       [busy]              active: 2
         processJob('scan:ADA:...')       [busy]              active: 3
         └→ All 3 running in parallel

T+03s    doAnalysisCore() calls LLMs      [busy × 3]          waiting: 9
         ├─ Groq: technician              [processing]        active: 3
         ├─ Anthropic: on-chain sleuth
         └─ Gemini: macro/psych

T+05s    First symbol completes (BTC)     [busy × 2]          waiting: 9
         └→ persistJobResult()                                 active: 2
         └→ Emit job_complete event

T+07s    Second symbol completes (ETH)    [busy × 1]          waiting: 8
         └→ persistJobResult()                                 active: 1
         └→ Emit job_complete event

T+10s    Third symbol completes (ADA)     [idle]              waiting: 8
         └→ persistJobResult()                                 active: 1
         └→ Emit job_complete event

T+10s    New batch dequeued               [busy × 3]          waiting: 5
         ├─ processJob('scan:SOL:...')                         active: 3
         ├─ processJob('scan:PEPE:...')
         └─ processJob('scan:XRP:...')

...      [Continue processing remaining symbols in batches]

T+160s   Last symbol completes            [idle]              waiting: 0
         └→ processJob returns                                 active: 0

T+160s   ✓ Queue drained!                 [idle]              waiting: 0
         └→ drained event fires                                active: 0
         └→ attachDrainListener() triggered
         └→ generateTieredReport()

T+165s   ✓ Report generated & stored      [idle]              waiting: 0
         └→ Cycle complete!                                    active: 0
         └→ Reset cycle tracking
         └→ Report available in Postgres

T+1200s  ✓ Next trigger                   [idle]              waiting: 0
         (~20 minutes later)
         └→ Cron matches again
         └→ Repeat cycle...
```

---

## State Machines

### Job Lifecycle

```
    START (repeatable job registers)
      ↓
  [WAITING] ← Enqueued by trigger-master-scan handler
      ↓
  [ACTIVE] ← Worker picks up job
      ↓
  [PROCESSING] ← doAnalysisCore() runs
      ├─ Success → [COMPLETED] → Remove (TTL 2h for results)
      └─ Failure → [FAILED] ← Retry with backoff
                      ↓
                   [DELAYED] ← Wait exponential backoff
                      ↓
                   [WAITING] ← Re-enqueue (up to 5 times)
```

### Scanner Cycle Lifecycle

```
    IDLE (waiting for next trigger time)
      ↓
    TRIGGER (cron matches */20)
      ↓
    [trigger-master-scan job created]
      ↓
    BUILDING_CANDIDATES (getSettings, getMacroPulse, getMarketRisk, getCachedGems)
      ↓
    ENQUEUING_CYCLE (enqueueScanCycle with 12 jobs)
      ↓
    PROCESSING (symbols analyzed in parallel, 3 concurrent)
      ├─ Job 1 → 150s (BTCUSDT)
      ├─ Job 2 → 120s (ETHUSDT)
      ├─ Job 3 → 145s (ADAUSDT)
      ├─ Job 4 → 135s (SOL)
      └─ ... (remaining 8 symbols)
      ↓
    DRAINING (waiting for last job to complete)
      ↓
    REPORT_GENERATING (generateTieredReport)
      ↓
    CYCLE_COMPLETE (results persisted, report stored)
      ↓
    IDLE (wait ~20 min for next trigger)
```

---

## Data Flow: Trigger → Report

```
trigger-master-scan Job
        ↓
    buildCandidateList()
        ├─ getAppSettings()
        │   └─ Postgres: app_settings table
        │       └─ Get confidence_threshold, trading.defaultTradeSizeUsd
        ├─ getMacroPulse()
        │   └─ HTTP: Binance API for market data
        │       └─ DXY, Fear/Greed Index, BTC dominance
        ├─ getMarketRiskSentiment()
        │   └─ Internal sentinel service
        │       └─ Volatility, ATR percentages
        └─ getCachedGemsTicker24h()
            └─ Cache or HTTP: Binance 24h volume top 50
                └─ Filter by volume, supported bases
                └─ Return top 12 candidates
        ↓
    enqueueScanCycle()
        └─ For each candidate:
            ├─ Job name: scan:SYMBOL:CYCLEID
            ├─ Data: { symbol, cycleId, macroCtx, priority }
            ├─ Options: retry 5x, custom backoff
            └─ Add to Redis queue bull:coin-scan:waiting
        ↓
    processJob(scan:SYMBOL:CYCLEID)
        ├─ doAnalysisCore(symbol, timestamp, false, { skipGemAlert: true, precomputedMacro })
        │   ├─ LLM Call 1 (Groq): Technical analyst
        │   ├─ LLM Call 2 (Anthropic): On-chain sleuth
        │   ├─ LLM Call 3 (Gemini): Macro + Psych agents
        │   ├─ Alpha Matrix: Combine tri-core probabilities
        │   └─ Return: AnalysisCoreResult
        │       ├─ Probability: 0–100
        │       ├─ Predicted direction: Bullish/Bearish/Neutral
        │       ├─ Target %: 2.5–50%
        │       ├─ Risk level: Low/Medium/High
        │       └─ Tri-core scores: groq, anthropic, gemini
        ├─ persistJobResult()
        │   └─ Redis: scan:result:CYCLEID:SYMBOL (TTL 2h)
        │       └─ Serialized AnalysisCoreResult.data
        └─ emitJobComplete()
            └─ SSE: job_complete event (for UI real-time)
        ↓
    [Repeat for all 12 symbols in parallel (concurrency: 3)]
        ↓
    QueueEvents: 'drained' event fires
        ↓
    generateTieredReport(cycleId, cycleStart)
        ├─ loadCycleResults(cycleId)
        │   └─ Redis SCAN: scan:result:CYCLEID:*
        │       └─ Get all 12 persisted results
        ├─ tieredReportGenerator()
        │   ├─ Rank by Alpha Matrix score
        │   ├─ Categorize: ELITE, STRONG, MODERATE, WEAK, UNRANKED
        │   ├─ Filter by confidence threshold
        │   └─ Sort by risk/reward
        ├─ Store in Postgres
        │   └─ reports table: { cycleId, tier, alphaScore, ... }
        └─ Emit SSE: report_generated
            ├─ Dashboard updates live
            └─ Telegram alerts (if ELITE & isElite flag)
        ↓
    CYCLE COMPLETE
        └─ Wait 20 minutes for next trigger
```

---

## Error Handling

### At Each Stage

| Stage | Error | Handler |
|-------|-------|---------|
| **trigger-master-scan** | Settings fetch fails | Use DEFAULT_APP_SETTINGS |
| | Macro pulse fails | Use DEFAULT_MACRO |
| | Market risk fails | Use safe fallback (SAFE status) |
| | No candidates | Audit warn, return early |
| **enqueueScanCycle** | Job add fails | Catch, audit error, re-throw |
| **doAnalysisCore** | LLM timeout (150s) | Catch timeout, audit failed, retry (up to 5x) |
| | Rate limit (429) | Exponential backoff, longer base delay (4s → 64s) |
| | Redis persistence fails | Audit error, continue (job still tracked) |
| **Report generation** | Result loading fails | Return empty array, create empty report |
| | Report storage fails | Audit error (doesn't prevent next cycle) |
| **Worker crash** | SIGTERM/SIGINT received | Graceful shutdown: close worker → close queue events → close Redis |

---

## Key Invariants

1. **Idempotency**: `setupAutoScanner()` checks if job exists; won't create duplicates
2. **Atomicity**: Each job either completes fully or fails (BullMQ handles retry)
3. **Ordering**: Candidates processed in priority order (index-based)
4. **Isolation**: Each cycle gets unique cycleId; no interference between cycles
5. **Durability**: Jobs persisted in Redis; survive process restart
6. **Concurrency**: At most `QUEUE_CONCURRENCY` (default 3) jobs in parallel
7. **Rate Limiting**: Backoff delays prevent API throttling

---

## Comparison: Before vs After

| Aspect | Before (Vercel Cron) | After (BullMQ) |
|--------|----------------------|----------------|
| **Trigger** | HTTP GET /api/cron/scan | BullMQ repeatable job |
| **Frequency Control** | Vercel Cron service | BullMQ + cron pattern + Redis |
| **State Persistence** | Ephemeral (lost on restart) | Redis (survives restart) |
| **Retry Logic** | Manual (re-trigger HTTP) | Built-in (BullMQ, up to 5x) |
| **Concurrency** | Sequential (single HTTP call) | Parallel (worker pool, 3 concurrent) |
| **Visibility** | Limited to logs | Full audit trail + Redis keys |
| **Monitoring** | HTTP status codes | BullMQ counters + audit events |
| **Scalability** | Limited by Vercel function limits | Limited by PM2 + Redis + LLM APIs |
| **Cost** | Vercel serverless pricing | PM2 VPS + Redis + LLM API credits |

---

## Redis Key Patterns

```
bull:coin-scan:repeat:trigger-master-scan:0
  └─ Repeatable job definition (BullMQ internal)

bull:coin-scan:waiting
  └─ Queue of jobs waiting to be processed

bull:coin-scan:active
  └─ Jobs currently being processed

bull:coin-scan:completed
  └─ Completed jobs (retained: 200 max)

bull:coin-scan:failed
  └─ Failed jobs after all retries

scan:result:CYCLE-ID:SYMBOL
  └─ Persisted analysis result (TTL: 2 hours)
  └─ Value: JSON stringified AnalysisCoreResult.data

scan:active_cycle_id
  └─ Current active cycle ID (TTL: 2 hours)
  └─ Used by drain listener to trigger report

cache:gems:...
  └─ Cached gem tickers (managed by cache-service)

cache:macro:...
  └─ Cached macro pulse data
```

---

## Deployment Checklist

- [ ] `lib/queue/scan-queue.ts`: Added `setupAutoScanner()` ✓
- [ ] `lib/queue/queue-worker.ts`: Updated `processJob()` to handle trigger-master-scan ✓
- [ ] `lib/queue/queue-worker.ts`: Added `setupAutoScanner()` call at startup ✓
- [ ] `lib/workers/market-scanner.ts`: Deprecated old functions ✓
- [ ] `app/api/cron/scan/route.ts`: Returns 410 Gone ✓
- [ ] `app/api/cron/enqueue/route.ts`: Marked manual-only ✓
- [ ] Remove `/api/cron/scan` from `vercel.json` cron rules
- [ ] Verify `.env` has `QUEUE_ENABLED=true` and `REDIS_URL` set
- [ ] Test: Start PM2 worker, wait 20 min for first trigger
- [ ] Monitor: Check PM2 logs, Redis keys, audit table
- [ ] Confirm: Repeatable job registers and triggers automatically
