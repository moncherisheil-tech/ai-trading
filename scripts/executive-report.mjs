import fs from 'node:fs';

const healthPath = 'reports/health-report.json';
const sloPath = 'reports/slo-evaluation.json';

if (!fs.existsSync(healthPath)) {
  console.error('health-report.json was not found. Run report:health first.');
  process.exit(1);
}

const health = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
const hasSlo = fs.existsSync(sloPath);
const slo = hasSlo ? JSON.parse(fs.readFileSync(sloPath, 'utf-8')) : null;

const checks = health?.checks || {};
const metrics = health?.payload?.metrics || {};
const quality = metrics?.quality || {};

const liveOk = Boolean(checks.live?.ok);
const readyOk = Boolean(checks.ready?.ok);
const metricsOk = Boolean(checks.metrics?.ok);
const sloPassed = hasSlo ? Boolean(slo?.passed) : null;

const overallStatus =
  liveOk && readyOk && metricsOk && (sloPassed === null || sloPassed)
    ? 'PASS'
    : 'FAIL';

const summary = {
  generatedAt: new Date().toISOString(),
  status: overallStatus,
  sourceTimestamp: health?.timestamp || null,
  checks: {
    live: { ok: liveOk, status: checks.live?.status ?? null },
    ready: { ok: readyOk, status: checks.ready?.status ?? null },
    metrics: { ok: metricsOk, status: checks.metrics?.status ?? null },
    slo: {
      evaluated: hasSlo,
      passed: hasSlo ? Boolean(slo?.passed) : null,
      violations: hasSlo ? slo?.violations || [] : [],
    },
  },
  quality: {
    sampleSize: Number(quality.sampleSize || 0),
    avgLatencyMs: Number(quality.avgLatencyMs || 0),
    p50LatencyMs: Number(quality.p50LatencyMs || 0),
    p95LatencyMs: Number(quality.p95LatencyMs || 0),
    fallbackRate: Number(quality.fallbackRate || 0),
    repairedRate: Number(quality.repairedRate || 0),
  },
  actions:
    overallStatus === 'PASS'
      ? ['No immediate action required. Continue periodic monitoring.']
      : [
          !readyOk ? 'Investigate readiness failures and recent deploy/runtime dependencies.' : null,
          hasSlo && !sloPassed ? 'Review SLO violations and execute mitigation/rollback procedures.' : null,
          !metricsOk ? 'Validate admin session and metrics endpoint availability.' : null,
        ].filter(Boolean),
};

const lines = [
  '# Executive Ops Summary',
  '',
  `- Generated At: ${summary.generatedAt}`,
  `- Source Timestamp: ${summary.sourceTimestamp || 'n/a'}`,
  `- Overall Status: ${summary.status}`,
  '',
  '## Service Checks',
  '',
  `- Live: ${summary.checks.live.ok ? 'ok' : 'failed'} (${summary.checks.live.status ?? 'n/a'})`,
  `- Ready: ${summary.checks.ready.ok ? 'ok' : 'failed'} (${summary.checks.ready.status ?? 'n/a'})`,
  `- Metrics: ${summary.checks.metrics.ok ? 'ok' : 'failed/skipped'} (${summary.checks.metrics.status ?? 'n/a'})`,
  `- SLO: ${summary.checks.slo.evaluated ? (summary.checks.slo.passed ? 'pass' : 'failed') : 'not-evaluated'}`,
  '',
  '## Quality Snapshot',
  '',
  `- Sample Size: ${summary.quality.sampleSize}`,
  `- Avg Latency (ms): ${summary.quality.avgLatencyMs}`,
  `- P50 Latency (ms): ${summary.quality.p50LatencyMs}`,
  `- P95 Latency (ms): ${summary.quality.p95LatencyMs}`,
  `- Fallback Rate: ${summary.quality.fallbackRate.toFixed(3)}`,
  `- Repaired Rate: ${summary.quality.repairedRate.toFixed(3)}`,
  '',
  '## Recommended Actions',
  '',
  ...summary.actions.map((item) => `- ${item}`),
  '',
];

if (summary.checks.slo.evaluated && summary.checks.slo.violations.length > 0) {
  lines.push('## SLO Violations', '');
  for (const violation of summary.checks.slo.violations) {
    lines.push(`- ${violation}`);
  }
  lines.push('');
}

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/executive-summary.json', JSON.stringify(summary, null, 2));
fs.writeFileSync('reports/executive-summary.md', lines.join('\n'));

console.log(`Executive summary generated (${summary.status}).`);
