/** Edge runtime not used: route depends on Node fs and getDbAsync (file or Postgres). */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { isAllowedIp } from '@/lib/security';

function readAuditStats() {
  const auditPath = path.join(process.cwd(), 'logs', 'audit.log');
  if (!fs.existsSync(auditPath)) {
    return { total: 0, errors: 0, warnings: 0 };
  }

  const lines = fs.readFileSync(auditPath, 'utf-8').split('\n').filter(Boolean);
  let errors = 0;
  let warnings = 0;

  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { level?: string };
      if (row.level === 'error') errors += 1;
      if (row.level === 'warn') warnings += 1;
    } catch {
      // Ignore malformed audit rows.
    }
  }

  return {
    total: lines.length,
    errors,
    warnings,
  };
}

export async function GET(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  if (isSessionEnabled()) {
    const token = request.cookies.get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  let rows: Awaited<ReturnType<typeof getDbAsync>>;
  try {
    rows = await getDbAsync();
  } catch (err) {
    console.error('Metrics route: getDbAsync failed', err);
    return NextResponse.json(
      { success: false, error: 'Database unavailable' },
      { status: 500 }
    );
  }
  const pending = rows.filter((r) => r.status === 'pending').length;
  const evaluated = rows.filter((r) => r.status === 'evaluated').length;
  const latencyRows = rows
    .map((r) => Number(r.latency_ms || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const avgLatency = latencyRows.reduce((acc, row) => acc + row, 0) / Math.max(1, latencyRows.length);
  const p50Index = Math.max(0, Math.floor(latencyRows.length * 0.5) - 1);
  const p95Index = Math.max(0, Math.floor(latencyRows.length * 0.95) - 1);
  const p50Latency = latencyRows[p50Index] || 0;
  const p95Latency = latencyRows[p95Index] || 0;
  const fallbackUsed = rows.filter((r) => r.fallback_used).length;
  const fallbackRate = rows.length > 0 ? fallbackUsed / rows.length : 0;

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    db: {
      total: rows.length,
      pending,
      evaluated,
    },
    quality: {
      fallbackUsed,
      fallbackRate,
      repaired: rows.filter((r) => r.validation_repaired).length,
      avgLatencyMs: Math.round(avgLatency),
      p50LatencyMs: Math.round(p50Latency),
      p95LatencyMs: Math.round(p95Latency),
    },
    audit: readAuditStats(),
  });
}
