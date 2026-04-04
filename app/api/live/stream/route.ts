/**
 * GET /api/live/stream — Server-Sent Events (SSE) live data pipeline.
 *
 * Replaces all decentralised client-side polling with a single persistent
 * connection per browser tab. The server pushes:
 *   - execution_snapshot  → full ExecutionDashboardSnapshot (every 20 s + on connect)
 *   - market_risk         → MarketRiskSentiment            (every 20 s + on connect)
 *   - alpha_job           → scan pipeline progress
 *   - alpha_report_ready  → report cycle complete
 *
 * Auth: session cookie (viewer role) — compatible with browser EventSource
 * which cannot set custom headers.
 */

import type { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';
import {
  hasRequiredRole,
  isDevelopmentAuthBypass,
  isSessionEnabled,
  verifySessionToken,
} from '@/lib/session';
import { alphaEventBus, type AlphaBusEvent } from '@/lib/webhooks/emitter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUSH_INTERVAL_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export async function GET(request: NextRequest): Promise<Response> {
  // Cookie-based auth so browser EventSource (no custom headers) works.
  if (isSessionEnabled() && !isDevelopmentAuthBypass()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'viewer')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // ── Helpers ──────────────────────────────────────────────────────────

      function push(eventName: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      }

      function heartbeat() {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          cleanup();
        }
      }

      function cleanup() {
        if (closed) return;
        closed = true;
        alphaEventBus.off('alpha', onAlpha);
        clearInterval(pushTimer);
        clearInterval(hbTimer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      // ── Alpha bus relay ───────────────────────────────────────────────────

      function onAlpha(event: AlphaBusEvent) {
        if (event.type === 'job_complete') {
          push('alpha_job', {
            symbol: event.symbol,
            tier: event.tier,
            alphaScore: event.alphaScore,
          });
        } else if (event.type === 'report_ready') {
          push('alpha_report_ready', { cycleId: event.payload.cycle_id });
        } else if (event.type === 'cycle_drained') {
          push('alpha_job', {
            symbol: '__cycle_drained__',
            tier: 'DRAIN',
            alphaScore: 0,
          });
        }
      }

      // ── Data push ─────────────────────────────────────────────────────────

      async function pushData() {
        if (closed) return;
        try {
          const [engineMod, sentinelMod] = await Promise.all([
            import('@/lib/trading/execution-engine'),
            import('@/lib/market-sentinel'),
          ]);
          const [snapResult, riskResult] = await Promise.allSettled([
            engineMod.getExecutionDashboardSnapshot(),
            sentinelMod.getMarketRiskSentiment(),
          ]);
          if (snapResult.status === 'fulfilled') {
            push('execution_snapshot', snapResult.value);
          }
          if (riskResult.status === 'fulfilled') {
            push('market_risk', riskResult.value);
          }
        } catch {
          // Never crash the stream on a push error; client retries on next interval.
        }
      }

      // ── Wire up ───────────────────────────────────────────────────────────

      alphaEventBus.on('alpha', onAlpha);
      const hbTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
      const pushTimer = setInterval(() => void pushData(), PUSH_INTERVAL_MS);

      // Immediately confirm connection and push initial state.
      push('connected', { ts: Date.now() });
      await pushData();

      request.signal?.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
