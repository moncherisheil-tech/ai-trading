# Zero-Touch Automation: Quick Reference

## What Changed?

| Aspect | Old | New |
|--------|-----|-----|
| **Scheduler** | Vercel Cron HTTP GET | BullMQ Repeatable Job (Redis) |
| **Trigger** | `/api/cron/scan` endpoint | `trigger-master-scan` job |
| **Worker** | Next.js Serverless Function | PM2 Process (queue-worker.ts) |
| **Frequency** | 20 minutes (Vercel Cron) | 20 minutes (BullMQ cron pattern) |
| **State** | Ephemeral | Persisted in Redis |

---

## Files Modified

1. **lib/queue/scan-queue.ts** — Added `setupAutoScanner()` + `TriggerMasterScanJobData`
2. **lib/queue/queue-worker.ts** — Updated `processJob()` to handle `trigger-master-scan` + call `setupAutoScanner()` at startup
3. **lib/workers/market-scanner.ts** — Deprecated `startMarketScanner()` / `stopMarketScanner()` (removed setInterval)
4. **app/api/cron/scan/route.ts** — Deprecated (returns 410 Gone)
5. **app/api/cron/enqueue/route.ts** — Marked manual-only (removed from auto scheduling)

---

## Deployment Steps

### 1. Update Vercel Configuration

Remove from `vercel.json`:
```json
{
  "path": "/api/cron/scan",
  "schedule": "*/20 * * * *"
}
```

### 2. Ensure Environment Variables

```bash
# On your PM2 VPS production server:
echo "QUEUE_ENABLED=true" >> .env
echo "REDIS_URL=redis://..." >> .env  # verify it's set
```

### 3. Restart PM2 Worker

```bash
pm2 restart queue-worker
# OR if first time:
pm2 start ecosystem.config.js --only queue-worker
```

### 4. Verify Startup (immediately)

```bash
pm2 logs queue-worker

# Look for:
# [AutoScanner] Repeatable job "trigger-master-scan" registered (every 20 minutes).
# [Worker] Auto-scanner scheduler initialized.
# [Worker] BullMQ worker started — queue="coin-scan", concurrency=3
```

### 5. Wait for First Trigger (within 20 minutes)

```bash
pm2 logs queue-worker | grep "trigger-master-scan"

# Expected after waiting ~20 min (or sooner if cron pattern aligns):
# [Worker] Processing trigger-master-scan (repeatable scheduler)
# [Worker] trigger-master-scan completed in XXms — enqueued N jobs for cycle UUID
```

---

## Verification Queries

### Redis
```bash
redis-cli

# Check repeatable job exists:
> KEYS "bull:coin-scan:repeat:*"
# Should show entries like: bull:coin-scan:repeat:trigger-master-scan:0

# Check if jobs are being enqueued:
> LLEN bull:coin-scan:waiting
# Should be > 0 when scheduler is active
```

### Audit Log
```sql
-- Check if scheduler triggered:
SELECT * FROM audits 
WHERE event = 'queue.trigger_master_scan_executed' 
ORDER BY created_at DESC LIMIT 5;

-- Check if manually triggered (should be rare):
SELECT * FROM audits 
WHERE event = 'queue.cycle_enqueued_manual' 
ORDER BY created_at DESC LIMIT 5;
```

### Database
```sql
-- Check scanner is enabled:
SELECT scanner_is_active FROM system_settings LIMIT 1;
```

---

## Troubleshooting

### Repeatable Job Not Triggering

**Step 1:** Check PM2 is running
```bash
pm2 status queue-worker
# Should show "online"
```

**Step 2:** Check Redis connectivity
```bash
redis-cli ping
# Should return PONG
```

**Step 3:** Check logs for errors
```bash
pm2 logs queue-worker --err
# Look for [AutoScanner] or [Worker] error lines
```

**Step 4:** Check scanner is enabled
```sql
SELECT scanner_is_active FROM system_settings;
```

**Step 5:** Manually test enqueue endpoint (as fallback)
```bash
curl -H "x-cron-secret: $CRON_SECRET" https://your-domain.com/api/cron/enqueue
# Should return: {"ok":true,"cycleId":"...","enqueued":12,"note":"Manual trigger only..."}
```

### High Memory Usage

**Cause:** Persisted job results (default 7200s TTL).

**Solution:** Let TTL expire naturally, or reduce TTL in `scan-queue.ts`:
```typescript
await persistJobResult(result);  // in queue-worker.ts processJob()
// Stored as: getRedisClient().set(key, value, 'EX', 3600)  // 1 hour instead of 2 hours
```

### Job Never Completes

**Check:** Is the per-symbol analysis timeout too short?
```bash
# In queue-worker.ts:
const PER_JOB_TIMEOUT_MS = Number(process.env.QUEUE_JOB_TIMEOUT_MS ?? 150_000);
# Increase if needed (e.g. 200000 for 200s)
```

---

## Monitoring

### Key Metrics to Track

1. **Repeatable Job Execution**
   - Audit event: `queue.trigger_master_scan_executed`
   - Frequency: Every 20 minutes
   - Duration: Should be < 30 seconds

2. **Symbol Analysis Jobs**
   - Audit event: `queue.job_complete`
   - Count: ~12 per cycle (depending on candidates)
   - Duration: ~150s per symbol

3. **Cycle Drains**
   - Audit event: `queue.drain_report_triggered` (in report generator)
   - Frequency: Once per cycle (after all symbols complete)

4. **Failures**
   - Audit event: `queue.trigger_master_scan_failed` or `queue.job_failed`
   - Should be rare; monitor for patterns

### Dashboard Queries

```sql
-- Last 10 scheduler triggers
SELECT created_at, meta->>'cycleId' as cycle_id, meta->>'count' as enqueued 
FROM audits 
WHERE event = 'queue.trigger_master_scan_executed' 
ORDER BY created_at DESC LIMIT 10;

-- Failed jobs (last 24h)
SELECT created_at, meta->>'symbol' as symbol, meta->>'error' as error
FROM audits 
WHERE event = 'queue.job_failed' AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Average per-symbol analysis time
SELECT 
  AVG((meta->>'durationMs')::int) as avg_duration_ms,
  MAX((meta->>'durationMs')::int) as max_duration_ms
FROM audits 
WHERE event = 'queue.job_complete' AND created_at > NOW() - INTERVAL '7 days';
```

---

## Rollback Plan

If issues arise, revert to HTTP-based Cron:

### Option A: Manual Cron Job (30s test)
```bash
# On VPS crontab:
*/20 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://your-domain.com/api/cron/enqueue > /dev/null 2>&1
```

### Option B: Restore Vercel Cron
```json
// In vercel.json:
{
  "crons": [
    {
      "path": "/api/cron/scan",
      "schedule": "*/20 * * * *"
    }
  ]
}
```

### Option C: Stop BullMQ Scheduler (Quick Disable)
```bash
# In Redis, remove repeatable job:
redis-cli DEL "bull:coin-scan:repeat:trigger-master-scan:0"
# Then restart worker:
pm2 restart queue-worker
```

---

## Success Indicators

✅ **First Deployment Successful When:**
1. PM2 logs show `[AutoScanner] Repeatable job registered`
2. After 20 minutes, logs show `trigger-master-scan completed`
3. Audit table has `queue.trigger_master_scan_executed` events
4. Symbol analysis jobs enqueue and complete normally
5. Tiered reports generate after each cycle

✅ **Stable Deployment When:**
1. Triggers happen reliably every 20 minutes
2. Zero manual intervention needed
3. Failure rate < 1% (transient network errors only)
4. Redis memory stable (no unbounded growth)
5. PM2 worker uptime > 99%

---

## Backwards Compatibility

- ✅ Old `startMarketScanner()` / `stopMarketScanner()` still exist (deprecated no-ops)
- ✅ Manual `/api/cron/enqueue` endpoint still works
- ✅ All existing job names/formats unchanged
- ✅ Audit logging extended (new events added, old ones still exist)

**Nothing breaks**; this is a pure **scheduling layer replacement**.

---

## Questions?

1. **"Can I manually trigger a scan?"**  
   Yes, call `/api/cron/enqueue` (marked manual-only in response).

2. **"Can I change the 20-minute frequency?"**  
   Yes, in `setupAutoScanner()`:
   ```typescript
   pattern: '*/30 * * * *'  // Change to 30 minutes
   ```

3. **"What if Redis goes down?"**  
   Repeatable job pauses until Redis recovers. Jobs in queue are lost (same as before).

4. **"Can I run multiple workers?"**  
   Yes, but `setupAutoScanner()` is idempotent (checks for existing job first).

5. **"Do I need to keep the Vercel Cron route?"**  
   No, remove it from `vercel.json`. The HTTP endpoint still exists but returns 410.

---

## References

- BullMQ Repeatable Jobs: https://docs.bullmq.io/guide/jobs/repeatable
- Cron Pattern Syntax: https://crontab.guru/
- PM2 Ecosystem Config: https://pm2.keymetrics.io/docs/usage/ecosystem-file/
- Redis CLI: https://redis.io/docs/latest/commands/
