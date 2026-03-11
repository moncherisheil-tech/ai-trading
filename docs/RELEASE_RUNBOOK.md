# Release Checklist and Runbook

## Pre-Release Checklist

- Verify required environment variables are set:
  - GEMINI_API_KEY
  - GEMINI_MODEL_PRIMARY
  - GEMINI_MODEL_FALLBACK
  - ANALYSIS_RATE_LIMIT_MAX
  - ANALYSIS_RATE_LIMIT_WINDOW_MS
  - ANALYSIS_DEDUP_WINDOW_MS
  - APP_AUTH_TOKEN
  - ADMIN_LOGIN_PASSWORD
  - TURNSTILE_SECRET_KEY
  - WORKER_CRON_SECRET
  - UPSTASH_REDIS_REST_URL
  - UPSTASH_REDIS_REST_TOKEN
- Run static checks:
  - npm run lint
  - npm run test
  - npm run build
  - npm run migrate:postgres (if DB_DRIVER=postgres)
  - npm run smoke:auth (if session auth is enabled)
  - npm run smoke:health
- Validate manual smoke scenarios:
  - Analyze BTCUSDT end-to-end
  - Analyze invalid symbol and verify safe error handling
  - Run Evaluate Past Predictions and verify updates
  - Confirm ticker reconnects after temporary network disconnect
- Check prediction quality signals:
  - At least one recent record includes structured sources
  - Telemetry fields are populated (model_name, latency_ms)

## Release Steps

1. Merge approved PR into main branch.
2. If session auth is enabled, call GET /api/auth/csrf and POST /api/auth/login to initialize admin session for smoke checks.
3. Wait for CI to pass on the merge commit.
4. Deploy application to target environment.
5. Verify app health:
Main page opens.
Analysis action responds within acceptable latency.
No server startup errors.
/api/health/live and /api/health/ready return success.
/ops dashboard loads for admin session.
6. Announce release version and key changes.
7. Trigger Ops Smoke workflow and archive the latest health report artifact.
8. Review `reports/executive-summary.md` artifact and attach it to release notes.

## Rollback Plan

1. If release introduces critical regressions, redeploy the previous stable version.
2. Confirm core flows on rollback version:
   - Analyze action
   - Evaluate action
   - Ticker connectivity
3. Record incident summary with:
   - failure trigger
   - blast radius
   - mitigation performed
4. Open follow-up issue for root-cause fix before next release.

## Post-Release Monitoring

- Monitor logs for spikes in:
  - Analysis failed errors
  - Upstream API request failures
  - Rate limit rejections
  - Unauthorized session attempts
- Track prediction telemetry trends:
  - fallback_used ratio
  - validation_repaired ratio
  - latency_ms p50/p95

For session key rotation and security hardening workflow, see [docs/SECURITY_OPERATIONS.md](docs/SECURITY_OPERATIONS.md).
For SLO thresholds and reliability policy, see [docs/SRE_SLO.md](docs/SRE_SLO.md).
