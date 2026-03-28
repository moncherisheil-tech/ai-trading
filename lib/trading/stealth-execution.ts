import { type BrokerOrderResult, type BrokerOrderSide, type IBrokerAdapter } from '@/lib/trading/broker-adapter';

export interface TwapExecutionChunkResult {
  chunkIndex: number;
  plannedDelayMs: number;
  jitterMs: number;
  amount: number;
  executedAt: string;
  order: BrokerOrderResult;
}

export interface TwapExecutionResult {
  symbol: string;
  side: BrokerOrderSide;
  totalAmount: number;
  durationMinutes: number;
  chunks: number;
  intervalMs: number;
  startedAt: string;
  finishedAt: string;
  chunkResults: TwapExecutionChunkResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function roundAmount(value: number, precision = 8): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function deterministicJitterMs(maxAbsJitterMs: number, seed: string): number {
  if (maxAbsJitterMs <= 0) return 0;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const range = maxAbsJitterMs * 2 + 1;
  const offset = Math.abs(hash >>> 0) % range;
  return offset - maxAbsJitterMs;
}

export class StealthExecutionEngine {
  constructor(private readonly broker: IBrokerAdapter) {}

  async executeTWAP(
    symbol: string,
    side: BrokerOrderSide,
    totalAmount: number,
    durationMinutes: number,
    chunks: number,
    options?: { idempotencyKeyPrefix?: string }
  ): Promise<TwapExecutionResult> {
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error('TWAP totalAmount must be a positive number.');
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new Error('TWAP durationMinutes must be a positive number.');
    }
    if (!Number.isInteger(chunks) || chunks <= 0) {
      throw new Error('TWAP chunks must be a positive integer.');
    }

    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const idemBase = (options?.idempotencyKeyPrefix ?? `twap-${startedAt}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    const totalMs = durationMinutes * 60_000;
    const intervalMs = totalMs / chunks;
    const maxAbsJitterMs = Math.min(5_000, Math.floor(intervalMs * 0.25));
    const chunkAmount = roundAmount(totalAmount / chunks);
    const results: TwapExecutionChunkResult[] = [];

    for (let i = 0; i < chunks; i += 1) {
      const executedAmount = i === chunks - 1 ? roundAmount(totalAmount - chunkAmount * (chunks - 1)) : chunkAmount;
      const plannedTimeFromStartMs = Math.floor(intervalMs * i);
      const elapsedMs = Date.now() - startedAtDate.getTime();
      const waitUntilPlannedMs = Math.max(0, plannedTimeFromStartMs - elapsedMs);
      const jitterMs = i === 0 ? 0 : deterministicJitterMs(maxAbsJitterMs, `${startedAt}-${i}-${symbol}-${side}`);
      const plannedDelayMs = Math.max(0, waitUntilPlannedMs + jitterMs);

      if (plannedDelayMs > 0) {
        await sleep(plannedDelayMs);
      }

      const chunkId = `${idemBase}c${i + 1}`.slice(0, 36);
      const order = await this.broker.createMarketOrder(symbol, side, executedAmount, {
        clientOrderId: chunkId,
      });
      results.push({
        chunkIndex: i + 1,
        plannedDelayMs,
        jitterMs,
        amount: executedAmount,
        executedAt: new Date().toISOString(),
        order,
      });
    }

    return {
      symbol,
      side,
      totalAmount,
      durationMinutes,
      chunks,
      intervalMs,
      startedAt,
      finishedAt: new Date().toISOString(),
      chunkResults: results,
    };
  }
}
