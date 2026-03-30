# Validation Checklist & Testing Guide

## Pre-Deployment Validation

### Code Review

- [ ] **scan-queue.ts**
  - [ ] `setupAutoScanner()` function exists
  - [ ] Uses `queue.getRepeatableJobs()` to check for duplicates
  - [ ] Cron pattern is `*/20 * * * *` (every 20 minutes)
  - [ ] Error handling with try/catch
  - [ ] Exported properly

- [ ] **queue-worker.ts**
  - [ ] Imports include `setupAutoScanner`, `enqueueScanCycle`, `randomUUID`
  - [ ] `processJob()` checks `job.name === 'trigger-master-scan'`
  - [ ] Trigger handler calls `buildCandidateList()` and `enqueueScanCycle()`
  - [ ] Standard symbol jobs still handled by existing logic
  - [ ] Worker type signature includes union types
  - [ ] `setupAutoScanner()` called at startup
  - [ ] Error handling for setup failure includes `process.exit(1)`

- [ ] **market-scanner.ts**
  - [ ] `intervalId` variable removed
  - [ ] `startMarketScanner()` is a no-op (deprecated warning only)
  - [ ] `stopMarketScanner()` is a no-op (deprecated warning only)
  - [ ] `runOneCycle()` still exists (used by tests/fallback)
  - [ ] `buildCandidateList()` still exported (used by queue-worker)

- [ ] **app/api/cron/scan/route.ts**
  - [ ] Returns HTTP 410 Gone
  - [ ] Response includes `deprecated: true` marker
  - [ ] JSDoc marked as `@deprecated`
  - [ ] Logs warning when called

- [ ] **app/api/cron/enqueue/route.ts**
  - [ ] JSDoc marked as `@deprecated`
  - [ ] Audit event changed to `queue.cycle_enqueued_manual`
  - [ ] Response includes note about manual-only usage
  - [ ] Still functional for on-demand triggers

### TypeScript Compilation

```bash
cd /path/to/project
npx tsc --noEmit

# Expected: No errors in modified files
# Warning: Terminal may show path encoding issues due to Hebrew characters
#          But if the JSON output is clean (no TS errors), you're good.
```

**Expected Output:**
```
✓ TypeScript compilation successful (0 errors)
```

### Linting

```bash
npx eslint lib/queue/queue-worker.ts lib/queue/scan-queue.ts --max-warnings 0

# Expected: No errors or warnings
```

---

## Local Testing (Optional)

### Unit Test: setupAutoScanner() Idempotency

```typescript
// test/lib/queue/scan-queue.test.ts (example)

describe('setupAutoScanner', () => {
  it('should be idempotent (no duplicates on second call)', async () => {
    const queue = getCoinScanQueue();
    
    // First call
    await setupAutoScanner();
    const jobs1 = await queue.getRepeatableJobs();
    const count1 = jobs1.filter(j => j.name === 'trigger-master-scan').length;
    expect(count1).toBe(1);
    
    // Second call (should not duplicate)
    await setupAutoScanner();
    const jobs2 = await queue.getRepeatableJobs();
    const count2 = jobs2.filter(j => j.name === 'trigger-master-scan').length;
    expect(count2).toBe(1);  // Still 1, not 2
  });

  it('should create job with correct cron pattern', async () => {
    const queue = getCoinScanQueue();
    await setupAutoScanner();
    const jobs = await queue.getRepeatableJobs();
    const triggerJob = jobs.find(j => j.name === 'trigger-master-scan');
    expect(triggerJob?.pattern).toBe('*/20 * * * *');
  });
});
```

### Integration Test: Full Cycle (Manual)

```bash
# 1. Start queue worker locally (or in staging)
pm2 start ecosystem.config.js --only queue-worker

# 2. Check logs for setup
pm2 logs queue-worker | grep -i "auto-scanner\|trigger-master-scan"

# Expected within 5 seconds:
# [AutoScanner] Repeatable job "trigger-master-scan" registered (every 20 minutes).
# [Worker] Auto-scanner scheduler initialized.

# 3. Check Redis for repeatable job
redis-cli KEYS "bull:coin-scan:repeat:*"
# Expected:
# 1) "bull:coin-scan:repeat:trigger-master-scan:0"

# 4. Manually enqueue trigger (force test without waiting 20 min)
node -e "
const { getCoinScanQueue } = require('./lib/queue/scan-queue.ts');
const q = getCoinScanQueue();
q.add('trigger-master-scan', { triggeredAt: Date.now() })
  .then(() => console.log('Manually enqueued trigger'))
  .catch(e => console.error('Error:', e.message));
"

# 5. Watch logs for processing
pm2 logs queue-worker | tail -50

# Expected sequence:
# [Worker] Processing trigger-master-scan (repeatable scheduler)
# [Worker] No candidates found for this cycle.  OR
# [Worker] trigger-master-scan completed in XXms — enqueued N jobs for cycle UUID
```

---

## Staging/Production Deployment

### Pre-Deployment Checklist

- [ ] **Environment Variables Set**
  ```bash
  echo $QUEUE_ENABLED          # Should be: true
  echo $REDIS_URL              # Should be: redis://...
  echo $QUEUE_CONCURRENCY      # Should be: 3 (or configured value)
  echo $QUEUE_JOB_TIMEOUT_MS   # Should be: 150000 (or configured value)
  ```

- [ ] **Redis Accessible**
  ```bash
  redis-cli ping
  # Expected: PONG
  ```

- [ ] **PM2 Status**
  ```bash
  pm2 status
  # Check: Is queue-worker currently running? (stop it first)
  ```

- [ ] **Vercel Configuration Updated**
  ```bash
  grep -n "api/cron/scan" vercel.json
  # Expected: No matches (route removed from cron rules)
  ```

- [ ] **Backups Created** (if applicable)
  ```bash
  # Backup Redis data (if using snapshots)
  # Backup Postgres (if using transactional data)
  ```

### Deployment Steps

**Step 1: Deploy Code**
```bash
# Option A: Using git
git add -A
git commit -m "feat: migrate to BullMQ repeatable jobs for zero-touch automation"
git push origin main

# Option B: Direct file transfer
scp -r lib/queue/queue-worker.ts user@vps:/path/to/app/lib/queue/
scp -r lib/workers/market-scanner.ts user@vps:/path/to/app/lib/workers/
scp -r app/api/cron/scan/route.ts user@vps:/path/to/app/app/api/cron/scan/
scp -r app/api/cron/enqueue/route.ts user@vps:/path/to/app/app/api/cron/enqueue/
```

**Step 2: Remove Vercel Cron Rule**
```bash
# Edit vercel.json (remove the /api/cron/scan cron rule)
# Before:
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "*/20 * * * *" },
    { "path": "/api/cron/worker/evening-summary", "schedule": "0 20 * * *" }
  ]
}

# After:
{
  "crons": [
    { "path": "/api/cron/worker/evening-summary", "schedule": "0 20 * * *" }
  ]
}

git add vercel.json
git commit -m "remove: deprecate vercel cron trigger for market scanner"
git push origin main
```

**Step 3: Restart PM2 Worker**
```bash
# SSH into VPS
ssh user@vps

# Stop old worker (if running)
pm2 stop queue-worker

# Pull latest code
cd /path/to/app
git pull origin main

# Install dependencies (if needed)
npm install

# Start new worker
pm2 start ecosystem.config.js --only queue-worker

# Verify startup
pm2 logs queue-worker
```

---

## Post-Deployment Validation

### Immediate Checks (First 30 seconds)

**Check 1: Worker Started**
```bash
pm2 status queue-worker
# Expected: online
```

**Check 2: Auto-Scanner Registered**
```bash
pm2 logs queue-worker | grep "auto-scanner\|Auto-scanner"

# Expected:
# [AutoScanner] Repeatable job "trigger-master-scan" registered (every 20 minutes).
# [Worker] Auto-scanner scheduler initialized.
# [Worker] BullMQ worker started — queue="coin-scan", concurrency=3
```

**Check 3: No Startup Errors**
```bash
pm2 logs queue-worker --err | head -20

# Expected: No [ERROR] or [CRITICAL] lines
```

**Check 4: Redis Connection Verified**
```bash
redis-cli PING
# Expected: PONG

redis-cli KEYS "bull:coin-scan:*" | wc -l
# Expected: > 0 (at least the repeatable job key exists)
```

### Short-term Monitoring (First Hour)

**Check 5: Manual Trigger Test**
```bash
# Manually call the enqueue endpoint to verify fallback still works
curl -s -H "x-cron-secret: $CRON_SECRET" \
  https://your-domain.com/api/cron/enqueue | jq .

# Expected:
# {
#   "ok": true,
#   "cycleId": "UUID",
#   "enqueued": 12,
#   "symbols": ["BTCUSDT", ...],
#   "note": "Manual trigger only — automatic scheduling is handled by BullMQ repeatable jobs."
# }
```

**Check 6: Deprecated Endpoint Returns 410**
```bash
curl -i https://your-domain.com/api/cron/scan

# Expected:
# HTTP/1.1 410 Gone
# {
#   "deprecated": true,
#   "message": "This endpoint is deprecated. Remove from vercel.json.",
#   "details": "Use BullMQ repeatable jobs (setupAutoScanner) instead."
# }
```

**Check 7: Audit Trail**
```sql
-- Check for recent enqueue events (manual or scheduler)
SELECT created_at, event, meta->>'cycleId' as cycle_id 
FROM audits 
WHERE event LIKE '%queue%' 
ORDER BY created_at DESC 
LIMIT 20;

-- Expected: Recent entries with queue.* events
```

### Medium-term Monitoring (First 20 Minutes)

**Wait for the next automatic trigger (cron pattern alignment).**

The repeatable job triggers at:
- :00, :20, :40 of every hour (pattern `*/20 * * * *`)

If you deploy at :05, next trigger is at :20 (15 minutes).

**Check 8: Automatic Trigger Fired**
```bash
pm2 logs queue-worker | grep "trigger-master-scan\|CYCLE"

# Expected after ~20 minutes:
# [Worker] Processing trigger-master-scan (repeatable scheduler)
# [Worker] trigger-master-scan completed in XXms — enqueued 12 jobs for cycle UUID
# [Worker] Processing BTCUSDT (cycle=UUID, attempt=1)
# [Worker] Processing ETHUSDT (cycle=UUID, attempt=1)
# [Worker] Processing ADAUSDT (cycle=UUID, attempt=1)
```

**Check 9: Symbol Analysis in Progress**
```bash
# Watch real-time processing
pm2 logs queue-worker --tail=50 --lines=100

# Expected stream:
# [Worker] Processing SYMBOL (cycle=UUID, attempt=1)
# [Worker] SYMBOL completed in XXms
# (repeats for ~12 symbols)
```

**Check 10: Queue Drain Event**
```bash
pm2 logs queue-worker | grep "drained\|drain\|DRAIN"

# Expected after all symbols complete:
# [ScanQueue] Queue drained — triggering report for cycle UUID
```

**Check 11: Report Generation**
```bash
pm2 logs queue-worker | grep "report\|REPORT\|tiered"

# Expected:
# [TieredReportGenerator] Processing cycle UUID...
# [TieredReportGenerator] Stored report for cycle UUID
```

### Long-term Monitoring (First 24 Hours)

**Check 12: Multiple Cycles Complete**
```sql
-- Verify at least 2–3 cycles have completed
SELECT COUNT(DISTINCT meta->>'cycleId') as cycles_completed
FROM audits 
WHERE event = 'queue.trigger_master_scan_executed'
AND created_at > NOW() - INTERVAL '24 hours';

-- Expected: >= 1 (at least one successful cycle)
```

**Check 13: No Excessive Failures**
```sql
-- Check failure rate
SELECT 
  COUNT(CASE WHEN event LIKE '%failed' THEN 1 END) as failures,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(CASE WHEN event LIKE '%failed' THEN 1 END) / 
        COUNT(*), 2) as failure_pct
FROM audits 
WHERE event LIKE '%queue%'
AND created_at > NOW() - INTERVAL '24 hours';

-- Expected: failure_pct < 5% (transient network errors OK)
```

**Check 14: Redis Memory Usage Stable**
```bash
redis-cli INFO memory | grep "used_memory_human\|used_memory_peak_human"

# Expected: Stable or gradually increasing, not exponential growth
# Normal: 100MB → 150MB over 24h (due to job results cache TTL)
```

**Check 15: No Worker Restarts**
```bash
pm2 show queue-worker | grep "restarts\|pm2_restarts"

# Expected: 0 or very low (< 5 in 24h)
# High restarts indicate crashes (check logs for errors)
```

---

## Troubleshooting Steps

### Scenario 1: "Repeatable Job Not Registered"

```bash
# Step 1: Check if setupAutoScanner() was called
pm2 logs queue-worker | grep -i "auto-scanner"
# If no output → setup not called; check worker startup logs for errors

# Step 2: Verify Redis connectivity
redis-cli PING
redis-cli INFO server
# If fails → Redis down; restart Redis

# Step 3: Check if job was created with wrong name
redis-cli KEYS "bull:coin-scan:repeat:*"
# If shows other names → manually delete and restart worker

# Step 4: Force re-create
redis-cli DEL "bull:coin-scan:repeat:trigger-master-scan:0"
pm2 restart queue-worker
pm2 logs queue-worker | grep -i "auto-scanner"
```

### Scenario 2: "Trigger Fires But No Candidates Found"

```bash
# Step 1: Check if scanner is enabled in settings
redis-cli
> SELECT 0
> GET "system_settings:scanner"
# Should have "scanner_is_active: true"

# If disabled:
# SET "system_settings:scanner" '{"scanner_is_active": true}'

# Step 2: Check gems cache
redis-cli KEYS "cache:gems:*"
# If empty → cache expired or fetch failed; let it repopulate

# Step 3: Check Binance API connectivity
curl -s "https://api.binance.com/api/v3/ticker/24hr?limit=50" | jq '.[] | .symbol' | head
# If fails → Binance API down (temporary, will retry)
```

### Scenario 3: "Symbol Analysis Timeout"

```bash
# Step 1: Check per-job timeout
echo $QUEUE_JOB_TIMEOUT_MS
# If < 150000 → increase to 150000 (150 seconds)
export QUEUE_JOB_TIMEOUT_MS=150000
pm2 restart queue-worker

# Step 2: Check LLM response times
pm2 logs queue-worker | grep "completed in XXms" | awk '{print $NF}' | sort -n | tail
# If most > 140s → increase timeout to 200000 (200 seconds)

# Step 3: Check LLM provider status
curl -s "https://api.groq.com/health" &
curl -s "https://api.anthropic.com/health" &
curl -s "https://generativelanguage.googleapis.com/health" &
wait
# If any fails → LLM provider issue; temporary, will retry
```

### Scenario 4: "Redis Memory Growing Unbounded"

```bash
# Step 1: Check expired keys
redis-cli KEYS "scan:result:*" | wc -l
# Should not exceed ~12 × 3 = 36 (assumes 3 concurrent cycles max)

# Step 2: Check if keys have TTL
redis-cli TTL "scan:result:SOME-ID:SYMBOL"
# If returns -1 → no TTL set; keys will persist forever (bug)

# Step 3: Manual cleanup
redis-cli EVAL "
  local keys = redis.call('KEYS', 'scan:result:*')
  for i,k in ipairs(keys) do
    redis.call('DEL', k)
  end
  return #keys
" 0
# This deletes all result keys; cycle will re-create as needed
```

### Scenario 5: "Worker Process Keeps Crashing"

```bash
# Step 1: Check error logs
pm2 logs queue-worker --err

# Step 2: Increase memory limit (if OOM errors)
pm2 start ecosystem.config.js --only queue-worker --max_memory_restart 1G

# Step 3: Check for infinite loops in processJob()
pm2 logs queue-worker | grep "Processing\|completed" | head -30
# If same job repeating endlessly → code bug; fix and redeploy

# Step 4: Check dependencies installed
npm ls bullmq redis
# If missing → npm install && npm install bullmq redis
```

---

## Rollback Plan

If deployment is unstable, rollback immediately:

### Option 1: Disable Repeatable Job (Quick)
```bash
redis-cli DEL "bull:coin-scan:repeat:trigger-master-scan:0"
pm2 restart queue-worker

# Worker continues but no auto-scheduler
# Manual triggers still work: /api/cron/enqueue
```

### Option 2: Revert to Vercel Cron (Full)
```bash
# 1. Restore vercel.json with /api/cron/scan route
git revert HEAD~1  # Or manually restore

# 2. Revert code changes
git checkout lib/queue/scan-queue.ts
git checkout lib/queue/queue-worker.ts
git checkout lib/workers/market-scanner.ts

# 3. Redeploy
git push origin main

# 4. Re-enable Vercel Cron (if using Vercel deployment)
vercel deploy --prod

# 5. Stop PM2 queue worker (if no longer needed)
pm2 stop queue-worker
pm2 delete queue-worker
```

### Option 3: Keep Code, Use Manual Trigger (Hybrid)
```bash
# Leave code as-is; disable repeatable job
redis-cli DEL "bull:coin-scan:repeat:trigger-master-scan:0"

# Manually trigger via external cron or scheduled task
0 */20 * * * curl -H "x-cron-secret: $CRON_SECRET" https://your-domain.com/api/cron/enqueue
```

---

## Success Criteria

✅ **Deployment is successful when:**

1. ✅ `setupAutoScanner()` logs appear in PM2 startup
2. ✅ Repeatable job key exists in Redis: `bull:coin-scan:repeat:trigger-master-scan:0`
3. ✅ First automatic trigger fires within 20 minutes of deployment
4. ✅ Symbol analysis jobs enqueue and process normally
5. ✅ Queue drains and report generates without errors
6. ✅ No crash loops or memory growth
7. ✅ Deprecated endpoints return 410 or manual-only messages
8. ✅ Audit trail shows `queue.trigger_master_scan_executed` events

🎉 **You're done!** The system is now running zero-touch automation with BullMQ repeatable jobs.

---

## Key Contacts / Escalation

| Issue | Contact | Resolution |
|-------|---------|-----------|
| Redis Down | DevOps / Infrastructure | Restart Redis service or failover |
| LLM API Errors | AI Team | Check provider status, increase API quota |
| Memory Leak | Backend Team | Check logic in processJob(), profile with node inspector |
| Repeatable Job Issues | BullMQ Docs | Search https://docs.bullmq.io/ or GitHub issues |
| Vercel Cron Remnants | DevOps | Clean up old cron rules from vercel.json |

---

## Appendix: Monitoring Dashboard Query

```sql
-- Comprehensive monitoring view (run periodically)
SELECT 
  'Scheduler' as check_name,
  COUNT(CASE WHEN event = 'queue.trigger_master_scan_executed' THEN 1 END) as count,
  MAX(created_at) as last_execution,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60)::int as minutes_since_last
FROM audits 
WHERE created_at > NOW() - INTERVAL '2 hours'

UNION ALL

SELECT 
  'Symbol Analysis',
  COUNT(CASE WHEN event = 'queue.job_complete' THEN 1 END),
  MAX(created_at),
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60)::int
FROM audits 
WHERE created_at > NOW() - INTERVAL '2 hours'

UNION ALL

SELECT 
  'Failed Jobs',
  COUNT(CASE WHEN event LIKE '%job_failed' THEN 1 END),
  MAX(created_at),
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60)::int
FROM audits 
WHERE created_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Reports Generated',
  COUNT(CASE WHEN event = 'queue.report_generated' OR event LIKE '%report%' THEN 1 END),
  MAX(created_at),
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60)::int
FROM audits 
WHERE created_at > NOW() - INTERVAL '24 hours';
```

**Run this query hourly to monitor health.** Expected:
- Scheduler count should increase every 20 minutes
- Symbol Analysis count should match Scheduler × ~12
- Failed Jobs should be < 5% of total
- Reports Generated should match Scheduler count
