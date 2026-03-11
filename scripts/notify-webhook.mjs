import fs from 'node:fs';

const webhook = process.env.ALERT_WEBHOOK_URL || '';
if (!webhook) {
  console.log('ALERT_WEBHOOK_URL not configured. Skipping notification.');
  process.exit(0);
}

const reportPath = 'reports/health-report.json';
const sloPath = 'reports/slo-evaluation.json';

if (!fs.existsSync(reportPath)) {
  console.error('Missing reports/health-report.json');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
const slo = fs.existsSync(sloPath) ? JSON.parse(fs.readFileSync(sloPath, 'utf-8')) : null;

const text = [
  'Ops Smoke Alert',
  `Timestamp: ${report.timestamp}`,
  `Live: ${report.checks?.live?.ok} (${report.checks?.live?.status})`,
  `Ready: ${report.checks?.ready?.ok} (${report.checks?.ready?.status})`,
  `Metrics: ${report.checks?.metrics?.ok} (${report.checks?.metrics?.status})`,
  slo ? `SLO Passed: ${slo.passed}` : 'SLO Passed: unknown',
  slo && Array.isArray(slo.violations) && slo.violations.length > 0 ? `Violations: ${slo.violations.join('; ')}` : 'Violations: none',
].join('\n');

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text }),
});

if (!res.ok) {
  console.error(`Webhook failed with status ${res.status}`);
  process.exit(1);
}

console.log('Webhook notification sent.');
