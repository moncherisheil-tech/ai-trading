import ccxt from 'ccxt';
import { stripEnvQuotes } from '@/lib/env';

export type BrokerOrderSide = 'buy' | 'sell';

export interface BrokerOrderResult {
  id: string;
  symbol: string;
  side: BrokerOrderSide;
  amount: number;
  status?: string;
  info?: unknown;
}

export type CreateMarketOrderOptions = {
  /** Binance newClientOrderId — idempotent retries must reuse the same id per logical order. */
  clientOrderId?: string;
};

export interface IBrokerAdapter {
  readonly isSimulated: boolean;
  fetchTicker(symbol: string): Promise<unknown>;
  fetchBalance(): Promise<unknown>;
  createMarketOrder(
    symbol: string,
    side: BrokerOrderSide,
    amount: number,
    options?: CreateMarketOrderOptions
  ): Promise<BrokerOrderResult>;
}

function normalizeCcxtSymbol(symbol: string): string {
  const withSlash = symbol.toUpperCase().replace(/[^A-Z0-9/]/g, '');
  if (withSlash.includes('/')) return withSlash;
  const clean = withSlash.replace(/\//g, '');
  if (clean.endsWith('USDT')) return `${clean.slice(0, -4)}/USDT`;
  return clean;
}

function toSafePositive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Order amount must be a positive finite number.');
  }
  return value;
}

export class SimulatedExchangeAdapter implements IBrokerAdapter {
  readonly isSimulated = true;

  async fetchTicker(symbol: string): Promise<unknown> {
    return {
      symbol: normalizeCcxtSymbol(symbol),
      status: 'AWAITING_LIVE_DATA',
      timestamp: Date.now(),
    };
  }

  async fetchBalance(): Promise<unknown> {
    return {
      status: 'AWAITING_LIVE_DATA',
      timestamp: Date.now(),
    };
  }

  async createMarketOrder(
    symbol: string,
    side: BrokerOrderSide,
    amount: number,
    options?: CreateMarketOrderOptions
  ): Promise<BrokerOrderResult> {
    const normalizedSymbol = normalizeCcxtSymbol(symbol);
    const safeAmount = toSafePositive(amount);
    const id = options?.clientOrderId?.trim() || `awaiting-live-${Date.now()}`;
    console.warn(`[BrokerAdapter] PAPER/simulated ${side.toUpperCase()} ${safeAmount} ${normalizedSymbol} (no exchange API).`);
    return {
      id,
      symbol: normalizedSymbol,
      side,
      amount: safeAmount,
      status: 'AWAITING_LIVE_DATA',
      info: { status: 'AWAITING_LIVE_DATA', clientOrderId: options?.clientOrderId },
    };
  }
}

export class CcxtBrokerAdapter implements IBrokerAdapter {
  readonly isSimulated = false;
  private readonly exchange: InstanceType<typeof ccxt.binance>;

  constructor(params?: { exchangeId?: 'binance'; testnet?: boolean }) {
    const exchangeId = params?.exchangeId ?? 'binance';
    // Live spot orders: Binance credentials only (vault-aligned with validateInfraEnv).
    const apiKey = stripEnvQuotes(process.env.BINANCE_API_KEY)?.trim();
    const secret =
      stripEnvQuotes(process.env.BINANCE_SECRET)?.trim() ||
      stripEnvQuotes(process.env.BINANCE_API_SECRET)?.trim();

    if (!apiKey || !secret) {
      throw new Error(
        'Missing Binance credentials for live connection. ' +
        'Set BINANCE_API_KEY and BINANCE_API_SECRET (or BINANCE_SECRET) in the environment.'
      );
    }

    if (exchangeId !== 'binance') {
      throw new Error(`Unsupported exchange: ${exchangeId}`);
    }

    const binance = new ccxt.binance({
      apiKey,
      secret,
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
      },
    });

    if (params?.testnet) {
      binance.setSandboxMode(true);
    }

    this.exchange = binance;
  }

  async fetchTicker(symbol: string): Promise<unknown> {
    return this.exchange.fetchTicker(normalizeCcxtSymbol(symbol));
  }

  async fetchBalance(): Promise<unknown> {
    return this.exchange.fetchBalance();
  }

  async createMarketOrder(
    symbol: string,
    side: BrokerOrderSide,
    amount: number,
    options?: CreateMarketOrderOptions
  ): Promise<BrokerOrderResult> {
    const normalizedSymbol = normalizeCcxtSymbol(symbol);
    const safeAmount = toSafePositive(amount);
    const clientOrderId = options?.clientOrderId?.trim();
    const params =
      clientOrderId && /^[a-zA-Z0-9_-]{4,36}$/.test(clientOrderId)
        ? { newClientOrderId: clientOrderId.slice(0, 36) }
        : {};
    const order = await this.exchange.createOrder(normalizedSymbol, 'market', side, safeAmount, undefined, params);
    return {
      id: String(order.id ?? `order-${Date.now()}`),
      symbol: normalizedSymbol,
      side,
      amount: safeAmount,
      status: typeof order.status === 'string' ? order.status : undefined,
      info: order.info,
    };
  }
}

export function createBrokerAdapter(options?: { allowSimulationFallback?: boolean; testnet?: boolean }): IBrokerAdapter {
  const allowFallback = options?.allowSimulationFallback ?? true;
  try {
    return new CcxtBrokerAdapter({ exchangeId: 'binance', testnet: options?.testnet ?? false });
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[BrokerAdapter] Falling back to simulated exchange: ${msg}`);
    return new SimulatedExchangeAdapter();
  }
}

/**
 * PAPER mode must never hit a real exchange.
 * LIVE uses CCXT with BINANCE_* keys; simulated only when allowSimulationFallback is true and keys are missing.
 */
export function createExecutionBrokerAdapter(
  mode: 'PAPER' | 'LIVE',
  options?: { allowSimulationFallback?: boolean; testnet?: boolean }
): IBrokerAdapter {
  if (mode === 'PAPER') {
    return new SimulatedExchangeAdapter();
  }
  return createBrokerAdapter(options);
}
