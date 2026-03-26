#!/usr/bin/env node
import 'dotenv/config';
/**
 * verify-save.mjs — Persistence verification script
 * Verifies that POST /api/settings/app persists data and GET returns it.
 * Usage: set BASE_URL (e.g. http://localhost:3000), then: node scripts/verify-save.mjs
 * For authenticated routes, set COOKIE_HEADER to a valid app_auth_token cookie if required.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const COOKIE_HEADER = process.env.COOKIE_HEADER || '';

async function fetchJson(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (COOKIE_HEADER) headers['Cookie'] = COOKIE_HEADER;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log('Persistence verification');
  console.log('BASE_URL:', BASE_URL);
  console.log('');

  // 1. GET current settings
  const getBefore = await fetchJson(`${BASE_URL}/api/settings/app`, { credentials: 'include' });
  if (!getBefore.ok) {
    console.error('GET /api/settings/app failed:', getBefore.status, getBefore.data);
    if (getBefore.status === 401) {
      console.log('Tip: If session is enabled, set COOKIE_HEADER with a valid app_auth_token cookie.');
    }
    process.exitCode = 1;
    return;
  }
  const before = getBefore.data;
  const originalTrading = before?.trading?.defaultTradeSizeUsd ?? 100;

  // 2. POST a small change (trading.defaultTradeSizeUsd)
  const testValue = typeof originalTrading === 'number' ? originalTrading + 1 : 101;
  const payload = {
    ...before,
    trading: { ...before?.trading, defaultTradeSizeUsd: testValue },
  };
  const postRes = await fetchJson(`${BASE_URL}/api/settings/app`, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!postRes.ok) {
    console.error('POST /api/settings/app failed:', postRes.status, postRes.data);
    if (postRes.data?.error) {
      console.error('Error message:', postRes.data.error);
      if (String(postRes.data.error).includes('DATABASE_URL')) {
        console.log('Fix: Set DATABASE_URL (or POSTGRES_URL) in .env and ensure migrations are applied (npm run migrate or node scripts/migrate-postgres.mjs).');
      }
    }
    process.exitCode = 1;
    return;
  }

  if (!postRes.data?.ok) {
    console.error('POST returned ok: false', postRes.data);
    process.exitCode = 1;
    return;
  }

  // 3. GET again and verify the value persisted
  const getAfter = await fetchJson(`${BASE_URL}/api/settings/app`, { credentials: 'include' });
  if (!getAfter.ok) {
    console.error('GET after POST failed:', getAfter.status);
    process.exitCode = 1;
    return;
  }
  const afterValue = getAfter.data?.trading?.defaultTradeSizeUsd;
  if (afterValue !== testValue) {
    console.error('Persistence check failed: expected trading.defaultTradeSizeUsd =', testValue, 'got', afterValue);
    process.exitCode = 1;
    return;
  }

  // 4. Restore original value
  const restorePayload = { ...getAfter.data, trading: { ...getAfter.data?.trading, defaultTradeSizeUsd: originalTrading } };
  await fetchJson(`${BASE_URL}/api/settings/app`, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(restorePayload),
  });

  console.log('OK: Data reached backend and was persisted. GET returned updated value:', afterValue);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exitCode = 1;
});
