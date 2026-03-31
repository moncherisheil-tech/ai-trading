/**
 * Alpha Report Emitter
 *
 * Fans out the completed AlphaReportPayload to three channels in parallel:
 *   1. HTTP POST webhook (WEBHOOK_URL env var)
 *   2. In-process SSE EventEmitter (consumed by /api/queue/events)
 *   3. Telegram: one concise summary message per qualified tier
 *
 * Failures in any one channel do not block the others.
 */

import { EventEmitter } from 'events';
import { sendTelegramMessage } from '@/lib/telegram';
import type { AlphaReportPayload, CoinPayload } from '@/lib/reports/payload-builder';

// ────────────────────────────────────────────────────────────────────────────
// In-process SSE bus (consumed by /api/queue/events SSE route)
// ────────────────────────────────────────────────────────────────────────────

class AlphaEventBus extends EventEmitter {}
export const alphaEventBus = new AlphaEventBus();
alphaEventBus.setMaxListeners(50);

export type AlphaBusEvent =
  | { type: 'job_complete'; symbol: string; tier: string; alphaScore: number }
  | { type: 'cycle_drained'; cycleId: string }
  | { type: 'report_ready'; payload: AlphaReportPayload };

export function emitBusEvent(event: AlphaBusEvent): void {
  alphaEventBus.emit('alpha', event);
}

// ────────────────────────────────────────────────────────────────────────────
// Webhook delivery
// ────────────────────────────────────────────────────────────────────────────

async function postWebhook(payload: AlphaReportPayload): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[Emitter] Webhook responded ${res.status} — payload still emitted locally.`);
    } else {
      console.log(`[Emitter] Webhook delivered to ${url}`);
    }
  } catch (err) {
    console.error('[Emitter] Webhook delivery failed:', err instanceof Error ? err.message : err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Telegram delivery
// ────────────────────────────────────────────────────────────────────────────

function formatCoinLine(c: CoinPayload): string {
  const dir = c.direction === 'Long' ? '🟢 Long' : '🔴 Short';
  return [
    `  *${c.ticker.replace('USDT', '')}* — ${dir}`,
    `  Entry: \`${c.entry_zone.low.toFixed(4)} – ${c.entry_zone.high.toFixed(4)}\``,
    `  TP1: \`${c.tp1.toFixed(4)}\` · TP2: \`${c.tp2.toFixed(4)}\``,
    `  SL: \`${c.stop_loss.toFixed(4)}\` (${c.sl_method}) · R:R ${c.risk_reward.toFixed(2)}`,
    `  Alpha Score: \`${(c.alpha_score * 100).toFixed(1)}%\` · Consensus: \`${c.llm_consensus_score.toFixed(1)}%\``,
  ].join('\n');
}

async function sendTelegramReport(payload: AlphaReportPayload): Promise<void> {
  const { tiers, cycle_id, meta } = payload;
  const totalQualified = meta.coins_qualified;
  if (totalQualified === 0) return;

  const lines: string[] = [
    `🧠 *Alpha Report — Cycle \`${cycle_id.slice(0, 8)}\`*`,
    `${meta.coins_scanned} scanned · ${totalQualified} qualified · ${(meta.queue_duration_ms / 1000).toFixed(0)}s`,
    '',
  ];

  if (tiers.S.length > 0) {
    lines.push('━━━━ 🏆 *Tier S — Alpha* ━━━━');
    for (const c of tiers.S) {
      lines.push(formatCoinLine(c));
      lines.push('');
    }
  }

  if (tiers.A.length > 0) {
    lines.push('━━━━ ⚡ *Tier A — High Yield* ━━━━');
    for (const c of tiers.A) {
      lines.push(formatCoinLine(c));
      lines.push('');
    }
  }

  if (tiers.B.length > 0) {
    lines.push('━━━━ 🔵 *Tier B — Steady* ━━━━');
    for (const c of tiers.B) {
      lines.push(formatCoinLine(c));
      lines.push('');
    }
  }

  const message = lines.join('\n').slice(0, 4000); // Telegram 4096 char limit
  try {
    await sendTelegramMessage(message, { parse_mode: 'Markdown' });
    console.log(`[Emitter] Telegram report sent (${totalQualified} coins).`);
  } catch (err) {
    console.error('[Emitter] Telegram delivery failed:', err instanceof Error ? err.message : err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fan-out the final Alpha Report to all configured channels.
 * All channels run in parallel; individual failures are isolated.
 */
export async function emitReport(payload: AlphaReportPayload): Promise<void> {
  console.log(
    `[Emitter] Broadcasting report for cycle ${payload.cycle_id} ` +
    `(${payload.meta.coins_qualified} qualified coins)`
  );

  emitBusEvent({ type: 'report_ready', payload });

  await Promise.allSettled([
    postWebhook(payload),
    sendTelegramReport(payload),
  ]);
}

/** Emit a single job-complete event (called from the BullMQ worker after each symbol). */
export function emitJobComplete(symbol: string, tier: string, alphaScore: number): void {
  emitBusEvent({ type: 'job_complete', symbol, tier, alphaScore });
}

/** Emit the cycle-drained event (called before report generation starts). */
export function emitCycleDrained(cycleId: string): void {
  emitBusEvent({ type: 'cycle_drained', cycleId });
}
