/**
 * Queue Events — Server-Sent Events (SSE) endpoint.
 *
 * Frontend components subscribe to this route to receive real-time updates:
 *   - job_complete   → one coin finished scanning
 *   - cycle_drained  → all coins done, report generation starting
 *   - report_ready   → final tiered Alpha Report is ready
 *
 * Authorization: ADMIN_SECRET or CRON_SECRET (Bearer header).
 * Heartbeat sent every 25 s to keep proxies from closing the connection.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { alphaEventBus, type AlphaBusEvent } from '@/lib/webhooks/emitter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      function send(event: AlphaBusEvent) {
        if (closed) return;
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      }

      function sendHeartbeat() {
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
        alphaEventBus.off('alpha', send);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }

      alphaEventBus.on('alpha', send);
      const heartbeat = setInterval(sendHeartbeat, 25_000);

      // Send initial connection confirmation
      send({ type: 'job_complete', symbol: '__connected__', tier: 'OK', alphaScore: 0 });

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
