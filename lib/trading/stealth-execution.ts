import {
  type BrokerOrderResult,
  type BrokerOrderSide,
  type BrokerFillSnapshot,
  type IBrokerAdapter,
} from '@/lib/trading/broker-adapter';

export interface TwapExecutionChunkResult {
  chunkIndex: number;
  clientOrderId: string;
  plannedDelayMs: number;
  jitterMs: number;
  amountRequested: number;
  amountFilledConfirmed: number;
  reconciliationStatus: 'confirmed' | 'assumed_simulated' | 'unconfirmed';
  reconciliationSource: BrokerFillSnapshot['source'] | 'none';
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
  totalFilledConfirmed: number;
  totalUnfilled: number;
  reconciliation: 'full' | 'partial' | 'unconfirmed';
  chunkResults: TwapExecutionChunkResult[];
}

export class TwapExecutionError extends Error {
  readonly partialResult: TwapExecutionResult;

  constructor(message: string, partialResult: TwapExecutionResult, cause?: unknown) {
    super(message);
    this.name = 'TwapExecutionError';
    this.partialResult = partialResult;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
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

  private buildResult(
    symbol: string,
    side: BrokerOrderSide,
    totalAmount: number,
    durationMinutes: number,
    chunks: number,
    intervalMs: number,
    startedAt: string,
    chunkResults: TwapExecutionChunkResult[]
  ): TwapExecutionResult {
    const totalFilledConfirmed = roundAmount(
      chunkResults.reduce((sum, chunk) => sum + chunk.amountFilledConfirmed, 0)
    );
    const totalUnfilled = roundAmount(Math.max(0, totalAmount - totalFilledConfirmed));
    const reconciliation =
      totalFilledConfirmed <= 0
        ? 'unconfirmed'
        : totalUnfilled <= 0.00000001
          ? 'full'
          : 'partial';
    return {
      symbol,
      side,
      totalAmount,
      durationMinutes,
      chunks,
      intervalMs,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalFilledConfirmed,
      totalUnfilled,
      reconciliation,
      chunkResults,
    };
  }

  async executeTWAP(
    symbol: string,
    side: BrokerOrderSide,
    totalAmount: number,
    durationMinutes: number,
    chunks: number,
    options?: { idempotencyKeyPrefix?: string; eventId?: string }
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

      const chunkIndex = i + 1;
      const chunkId = `${idemBase}c${chunkIndex}`.slice(0, 36);
      try {
        const order = await this.broker.createMarketOrder(symbol, side, executedAmount, {
          clientOrderId: chunkId,
          eventId: options?.eventId ?? idemBase,
          chunkIndex,
          reduceOnly: side === 'sell',
        });
        // Reconcile against broker/indexer after each chunk to avoid blind full-fill assumptions.
        const fillSnapshot = await this.broker.getFilledAmountByClientOrderId(
          symbol,
          side,
          chunkId,
          executedAmount
        );
        const confirmed = Number(fillSnapshot?.filledAmount ?? 0);
        if (!this.broker.isSimulated && (!fillSnapshot || !Number.isFinite(confirmed) || confirmed <= 0)) {
          results.push({
            chunkIndex,
            clientOrderId: chunkId,
            plannedDelayMs,
            jitterMs,
            amountRequested: executedAmount,
            amountFilledConfirmed: 0,
            reconciliationStatus: 'unconfirmed',
            reconciliationSource: fillSnapshot?.source ?? 'none',
            executedAt: new Date().toISOString(),
            order,
          });
          throw new TwapExecutionError(
            `[StealthExecution] Unable to confirm fill for chunk ${chunkIndex}; aborting with reconciliation required.`,
            this.buildResult(symbol, side, totalAmount, durationMinutes, chunks, intervalMs, startedAt, results)
          );
        }
        const boundedFill = roundAmount(Math.max(0, Math.min(executedAmount, confirmed)));
        results.push({
          chunkIndex,
          clientOrderId: chunkId,
          plannedDelayMs,
          jitterMs,
          amountRequested: executedAmount,
          amountFilledConfirmed: boundedFill,
          reconciliationStatus: this.broker.isSimulated ? 'assumed_simulated' : 'confirmed',
          reconciliationSource: fillSnapshot?.source ?? (this.broker.isSimulated ? 'simulated' : 'none'),
          executedAt: new Date().toISOString(),
          order,
        });
      } catch (err) {
        if (err instanceof TwapExecutionError) {
          throw err;
        }
        // Loop failure path: attempt a last broker/indexer reconciliation for the current chunk.
        const failoverSnapshot = await this.broker
          .getFilledAmountByClientOrderId(symbol, side, chunkId, executedAmount)
          .catch(() => null);
        const failoverConfirmed = Number(failoverSnapshot?.filledAmount ?? 0);
        if (Number.isFinite(failoverConfirmed) && failoverConfirmed > 0) {
          results.push({
            chunkIndex,
            clientOrderId: chunkId,
            plannedDelayMs,
            jitterMs,
            amountRequested: executedAmount,
            amountFilledConfirmed: roundAmount(Math.max(0, Math.min(executedAmount, failoverConfirmed))),
            reconciliationStatus: this.broker.isSimulated ? 'assumed_simulated' : 'confirmed',
            reconciliationSource: failoverSnapshot?.source ?? 'none',
            executedAt: new Date().toISOString(),
            order: {
              id: chunkId,
              symbol,
              side,
              amount: executedAmount,
              status: 'reconciled_after_error',
              info: { recoveredAfterError: true },
            },
          });
        }
        throw new TwapExecutionError(
          `[StealthExecution] TWAP chunk ${chunkIndex} failed; returning reconciled partial fills.`,
          this.buildResult(symbol, side, totalAmount, durationMinutes, chunks, intervalMs, startedAt, results),
          err
        );
      }
    }

    return this.buildResult(symbol, side, totalAmount, durationMinutes, chunks, intervalMs, startedAt, results);
  }
}
