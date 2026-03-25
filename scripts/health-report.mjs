import fs from 'node:fs';

const baseUrl = process.env.APP_URL || '';
const adminPassword = process.env.ADMIN_LOGIN_PASSWORD || '';

if (!baseUrl) {
  console.error('APP_URL is required for health-report.');
  process.exit(1);
}

async function fetchJson(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  return {
    ok: res.ok,
    status: res.status,
    body: parsed,
    headers: res.headers,
  };
}

async function getAuthCookie() {
  if (!adminPassword) return '';

  const csrf = await fetchJson('/api/auth/csrf');
  if (!csrf.ok) return '';

  const csrfToken = csrf.body?.csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie') || '';
  if (!csrfToken || !csrfCookie) return '';

  const login = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: csrfCookie,
    },
    body: JSON.stringify({ password: adminPassword, csrfToken }),
  });

  if (!login.ok) return '';

  const sessionCookie = login.headers.get('set-cookie') || '';
  return [csrfCookie, sessionCookie].filter(Boolean).join('; ');
}

const live = await fetchJson('/api/health/live');
const ready = await fetchJson('/api/health/ready');

const cookie = await getAuthCookie();
let metrics = { ok: false, status: 0, body: { note: 'Skipped (no admin credentials).' } };
if (cookie) {
  metrics = await fetchJson('/api/ops/metrics', {
    headers: { cookie },
  });
}

const now = new Date().toISOString();
const report = {
  timestamp: now,
  baseUrl,
  checks: {
    live: { ok: live.ok, status: live.status },
    ready: { ok: ready.ok, status: ready.status },
    metrics: { ok: metrics.ok, status: metrics.status },
  },
  payload: {
    live: live.body,
    ready: ready.body,
    metrics: metrics.body,
  },
};

const lines = [
  '# Runtime Health Report',
  '',
  `- Timestamp: ${now}`,
  `- App URL: ${baseUrl}`,
  '',
  '## Checks',
  '',
  `- live: ${live.ok ? 'ok' : 'failed'} (${live.status})`,
  `- ready: ${ready.ok ? 'ok' : 'failed'} (${ready.status})`,
  `- metrics: ${metrics.ok ? 'ok' : 'failed/skipped'} (${metrics.status})`,
  '',
  '## Ready Payload',
  '',
  '```json',
  JSON.stringify(ready.body, null, 2),
  '```',
  '',
  '## Metrics Payload',
  '',
  '```json',
  JSON.stringify(metrics.body, null, 2),
  '```',
  '',
];

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/health-report.md', lines.join('\n'));
fs.writeFileSync('reports/health-report.json', JSON.stringify(report, null, 2));

const healthy = live.ok && ready.ok;
if (!healthy) {
  console.error('Health report failed one or more checks.');
  process.exit(1);
}

console.log('Health report generated successfully.');
