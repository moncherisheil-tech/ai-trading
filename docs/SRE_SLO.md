# SRE SLO Policy

## Service Level Objectives

- Availability SLO:
  - Live check success: 99.9%
  - Ready check success: 99.5%
- Latency SLO:
  - Analyze path p95 latency <= 4000 ms
- Quality SLO:
  - Fallback rate <= 25%

## Automated Enforcement

- Health report job: `npm run report:health`
- SLO evaluation job: `npm run eval:slo`
- Alert dispatch: `npm run notify:webhook`

## Runtime Threshold Environment Variables

- SLO_MAX_P95_LATENCY_MS
- SLO_MAX_FALLBACK_RATE
- SLO_MAX_READY_FAILURES
- ALERT_WEBHOOK_URL

## Operational Notes

- SLO threshold values should be tuned per environment.
- Any SLO breach should trigger incident triage and follow-up action.
