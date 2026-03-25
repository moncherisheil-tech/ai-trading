import ccxt from 'ccxt';

export type BrokerOrderSide = 'buy' | 'sell';

export interface BrokerOrderResult {
  id: string;
  symbol: string;
  side: BrokerOrderSide;
  amount: number;
  status?: string;
  info?: unknown;
}

export interface IBrokerAdapter {
  readonly isSimulated: boolean;
  fetchTicker(symbol: string): Promise<unknown>;
  fetchBalance(): Promise<unknown>;
  createMarketOrder(symbol: string, side: BrokerOrderSide, amount: number): Promise<BrokerOrderResult>;
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
      last: 0,
      simulated: true,
      timestamp: Date.now(),
    };
  }

  async fetchBalance(): Promise<unknown> {
    return {
      simulated: true,
      free: { USDT: 100000 },
      total: { USDT: 100000 },
      timestamp: Date.now(),
    };
  }

  async createMarketOrder(symbol: string, side: BrokerOrderSide, amount: number): Promise<BrokerOrderResult> {
    const normalizedSymbol = normalizeCcxtSymbol(symbol);
    const safeAmount = toSafePositive(amount);
    const id = `sim-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    console.log(`[SimulatedExchange] MARKET ${side.toUpperCase()} ${safeAmount} ${normalizedSymbol} (${id})`);
    return {
      id,
      symbol: normalizedSymbol,
      side,
      amount: safeAmount,
      status: 'closed',
      info: { simulated: true },
    };
  }
}

export class CcxtBrokerAdapter implements IBrokerAdapter {
  readonly isSimulated = false;
  private readonly exchange: ccxt.Exchange;

  constructor(params?: { exchangeId?: 'binance'; testnet?: boolean }) {
    const exchangeId = params?.exchangeId ?? 'binance';
    const apiKey = process.env.EXCHANGE_API_KEY;
    const secret = process.env.EXCHANGE_SECRET;

    if (!apiKey || !secret) {
      throw new Error('Missing EXCHANGE_API_KEY / EXCHANGE_SECRET for live exchange connection.');
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

  async createMarketOrder(symbol: string, side: BrokerOrderSide, amount: number): Promise<BrokerOrderResult> {
    const normalizedSymbol = normalizeCcxtSymbol(symbol);
    const safeAmount = toSafePositive(amount);
    const order = await this.exchange.createOrder(normalizedSymbol, 'market', side, safeAmount);
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
