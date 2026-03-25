import fs from 'node:fs';

const path = 'reports/health-report.json';
if (!fs.existsSync(path)) {
  console.error('health-report.json was not found. Run report:health first.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(path, 'utf-8'));
const metrics = report?.payload?.metrics || {};
const quality = metrics?.quality || {};
const checks = report?.checks || {};

const maxP95Latency = Number(process.env.SLO_MAX_P95_LATENCY_MS || 4000);
const maxFallbackRate = Number(process.env.SLO_MAX_FALLBACK_RATE || 0.25);
const maxReadyFailures = Number(process.env.SLO_MAX_READY_FAILURES || 0);

const p95 = Number(quality.p95LatencyMs || 0);
const fallbackRate = Number(quality.fallbackRate || 0);
const readyFailures = checks.ready?.ok ? 0 : 1;

const violations = [];
if (p95 > maxP95Latency) {
  violations.push(`p95 latency ${p95} exceeded ${maxP95Latency}`);
}
if (fallbackRate > maxFallbackRate) {
  violations.push(`fallback rate ${fallbackRate.toFixed(3)} exceeded ${maxFallbackRate}`);
}
if (readyFailures > maxReadyFailures) {
  violations.push(`ready check failures ${readyFailures} exceeded ${maxReadyFailures}`);
}

const sloSummary = {
  timestamp: new Date().toISOString(),
  thresholds: {
    maxP95Latency,
    maxFallbackRate,
    maxReadyFailures,
  },
  observed: {
    p95LatencyMs: p95,
    fallbackRate,
    readyFailures,
  },
  violations,
  passed: violations.length === 0,
};

fs.writeFileSync('reports/slo-evaluation.json', JSON.stringify(sloSummary, null, 2));

if (violations.length > 0) {
  console.error('SLO evaluation failed:', violations.join('; '));
  process.exit(1);
}

console.log('SLO evaluation passed.');
