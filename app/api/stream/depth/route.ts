/**
 * GET /api/stream/depth?symbol=BTCUSDT
 *
 * Server-Sent Events tunnel that bridges the remote Rust HFT engine's Redis
 * pub/sub feed (`depth:BTCUSDT` / `depth:ETHUSDT`) to the browser.
 *
 * Security:
 *  - REDIS_HFT_URL is consumed exclusively server-side; never exposed to the client.
 *  - The query-param `symbol` is strictly sanitised and validated against an allowlist.
 *
 * Memory-leak prevention:
 *  - A dedicated ioredis subscriber connection is created per SSE request.
 *  - On client disconnect (request abort signal or stream cancel), the connection
 *    is unsubscribed and fully disconnected before the GC can claim it.
 */

import type { NextRequest } from 'next/server';
import Redis from 'ioredis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);
const HEARTBEAT_MS = 25_000;

export async function GET(request: NextRequest): Promise<Response> {
  // ── Symbol validation ────────────────────────────────────────────────────
  const raw = request.nextUrl.searchParams.get('symbol') ?? '';
  const symbol = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

  if (!SUPPORTED_SYMBOLS.has(symbol)) {
    return new Response(
      JSON.stringify({ error: 'Unsupported symbol. Use BTCUSDT or ETHUSDT.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const channel = `depth:${symbol}`;
  const encoder = new TextEncoder();

  // Mutable state shared across start / cancel / cleanup
  let closed = false;
  let subscriber: Redis | null = null;
  let hbTimer: ReturnType<typeof setInterval> | null = null;

  // ── Shared cleanup ───────────────────────────────────────────────────────
  function cleanup(controller?: ReadableStreamDefaultController) {
    if (closed) return;
    closed = true;

    if (hbTimer !== null) {
      clearInterval(hbTimer);
      hbTimer = null;
    }

    if (subscriber !== null) {
      const sub = subscriber;
      subscriber = null;
      // Fire-and-forget: unsubscribe gracefully, then hard-disconnect.
      sub
        .unsubscribe(channel)
        .catch(() => undefined)
        .finally(() => {
          try { sub.disconnect(); } catch { /* already gone */ }
        });
    }

    if (controller) {
      try { controller.close(); } catch { /* already closed */ }
    }
  }

  // ── SSE stream ───────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      function enqueue(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(controller);
        }
      }

      try {
        subscriber = new Redis(process.env.REDIS_HFT_URL ?? '', {
          lazyConnect: false,
          enableOfflineQueue: false,
          connectTimeout: 6_000,
          commandTimeout: 5_000,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null, // do not auto-retry; let the client reconnect via EventSource
        });

        subscriber.on('error', () => cleanup(controller));

        subscriber.on('message', (_ch: string, message: string) => {
          enqueue(`data: ${message}\n\n`);
        });

        await subscriber.subscribe(channel);

        // Confirm successful subscription
        enqueue(
          `data: ${JSON.stringify({ type: 'connected', symbol, ts: Date.now() })}\n\n`,
        );

        // Keepalive heartbeats so proxies / load balancers don't close the connection
        hbTimer = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            cleanup(controller);
          }
        }, HEARTBEAT_MS);
      } catch {
        cleanup(controller);
      }

      // Detect client disconnect via AbortSignal (works in Node.js runtime)
      request.signal?.addEventListener('abort', () => cleanup(controller));
    },

    cancel() {
      // Called when the ReadableStream consumer (the Response) is cancelled,
      // i.e. the browser closed the EventSource connection.
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
