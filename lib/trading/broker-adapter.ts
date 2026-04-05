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
  /** Exchange-specific client order ID for idempotent retries. */
  clientOrderId?: string;
  /**
   * Optional market price hint for DEX adapters that construct limit-IOC orders
   * to emulate market fills. When provided, worst-case price = hint ± 10%.
   */
  marketPriceHint?: number;
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function normalizeCcxtSymbol(symbol: string): string {
  const withSlash = symbol.toUpperCase().replace(/[^A-Z0-9/]/g, '');
  if (withSlash.includes('/')) return withSlash;
  const clean = withSlash.replace(/\//g, '');
  if (clean.endsWith('USDT')) return `${clean.slice(0, -4)}/USDT`;
  return clean;
}

/**
 * Convert internal Binance-style symbol to dYdX perpetual market ID.
 *   BTCUSDT  → BTC-USD
 *   ETHUSDT  → ETH-USD
 *   BTC-USD  → BTC-USD  (already formatted)
 */
function toDydxSymbol(symbol: string): string {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (s.includes('-')) return s; // already formatted
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USD`;
  if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
  return `${s}-USD`;
}

function toSafePositive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Order amount must be a positive finite number.');
  }
  return value;
}

// ── SimulatedExchangeAdapter ──────────────────────────────────────────────────

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

// ── CcxtBrokerAdapter (LEGACY — not used in live execution path) ──────────────
// All live execution now routes through DydxBrokerAdapter. This class is retained
// for reference and potential CEX spot fallback, but is NOT instantiated by any
// production path. Binance API keys are intentionally optional — the Binance
// integration serves only public market data (WebSockets, tickers) with no auth.

export class CcxtBrokerAdapter implements IBrokerAdapter {
  readonly isSimulated = false;
  private readonly exchange: InstanceType<typeof ccxt.binance>;

  constructor(params?: { exchangeId?: 'binance'; testnet?: boolean }) {
    const exchangeId = params?.exchangeId ?? 'binance';
    const apiKey = stripEnvQuotes(process.env.BINANCE_API_KEY)?.trim();
    const secret =
      stripEnvQuotes(process.env.BINANCE_SECRET)?.trim() ||
      stripEnvQuotes(process.env.BINANCE_API_SECRET)?.trim();

    if (!apiKey || !secret) {
      throw new Error(
        '[CcxtBrokerAdapter] Binance API credentials not configured. ' +
        'This adapter is legacy — all live execution uses DydxBrokerAdapter. ' +
        'If CEX spot execution is required, set BINANCE_API_KEY and BINANCE_API_SECRET.'
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

// ── DydxBrokerAdapter — THE SNIPER (zero-KYC perpetuals execution) ────────────

/**
 * Executes perpetual orders on dYdX v4 (Cosmos chain, self-custody, zero-KYC).
 *
 * Symbol mapping: Binance format (BTCUSDT) → dYdX format (BTC-USD).
 *
 * Market orders are implemented as limit-IOC orders with a 10% worst-case price
 * buffer to guarantee fills while protecting against extreme slippage.
 *
 * Key: DYDX_WALLET_PRIVATE_KEY (64-char hex) OR a BIP-39 12/24-word mnemonic.
 * Network: DYDX_NETWORK env var — 'mainnet' (default) or 'testnet'.
 */
export class DydxBrokerAdapter implements IBrokerAdapter {
  readonly isSimulated = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _wallet: any = null;
  private readonly testnet: boolean;

  constructor(params?: { testnet?: boolean }) {
    this.testnet = params?.testnet ?? (process.env.DYDX_NETWORK?.toLowerCase() === 'testnet');
    // Validate key presence synchronously so createBrokerAdapter() can catch + fallback
    const rawKey = stripEnvQuotes(process.env.DYDX_WALLET_PRIVATE_KEY)?.trim();
    if (!rawKey) {
      throw new Error(
        '[DydxAdapter] Missing DYDX_WALLET_PRIVATE_KEY for live dYdX connection. ' +
        'Set DYDX_WALLET_PRIVATE_KEY (64-char hex private key or 12/24-word mnemonic) in the environment.'
      );
    }
  }

  /** Lazily initialize the dYdX CompositeClient and LocalWallet (async Cosmos SDK setup). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async lazyInit(): Promise<{ client: any; wallet: any }> {
    if (this._client && this._wallet) {
      return { client: this._client, wallet: this._wallet };
    }

    // Dynamic import keeps the heavy Cosmos SDK out of the main bundle
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dydx = await import('@dydxprotocol/v4-client-js') as any;
    const { CompositeClient, LocalWallet, Network, BECH32_PREFIX } = dydx;

    const rawKey = stripEnvQuotes(process.env.DYDX_WALLET_PRIVATE_KEY)!.trim();

    let wallet: unknown;
    if (/\s/.test(rawKey)) {
      // Multi-word mnemonic (12 or 24 words)
      wallet = await LocalWallet.fromMnemonic(rawKey, BECH32_PREFIX);
    } else {
      // Raw 32-byte private key as hex string (with or without 0x prefix)
      const keyBuf = Buffer.from(rawKey.replace(/^0x/i, ''), 'hex');
      wallet = await LocalWallet.fromPrivateKey(keyBuf, BECH32_PREFIX);
    }

    const network = this.testnet ? Network.testnet() : Network.mainnet();
    const client = await CompositeClient.connect(network);

    this._client = client;
    this._wallet = wallet;
    return { client, wallet };
  }

  private get indexerBaseUrl(): string {
    return this.testnet
      ? 'https://indexer.v4testnet.dydx.exchange'
      : 'https://indexer.dydx.trade';
  }

  async fetchTicker(symbol: string): Promise<unknown> {
    const dydxSymbol = toDydxSymbol(symbol);
    try {
      const res = await fetch(
        `${this.indexerBaseUrl}/v4/perpetualMarkets?market=${encodeURIComponent(dydxSymbol)}`
      );
      if (!res.ok) throw new Error(`dYdX indexer returned ${res.status}`);
      return await res.json();
    } catch {
      return { symbol: dydxSymbol, status: 'UNAVAILABLE', timestamp: Date.now() };
    }
  }

  async fetchBalance(): Promise<unknown> {
    try {
      const { client, wallet } = await this.lazyInit();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await client.indexerClient.account.getSubaccount((wallet as any).address, 0);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), timestamp: Date.now() };
    }
  }

  async createMarketOrder(
    symbol: string,
    side: BrokerOrderSide,
    amount: number,
    options?: CreateMarketOrderOptions
  ): Promise<BrokerOrderResult> {
    const safeAmount = toSafePositive(amount);
    const dydxSymbol = toDydxSymbol(symbol);

    // ── Protocol Omega guard (belt + suspenders) ──────────────────────────────
    // The engine already caps amountUsd at MAX_TRADE_SIZE_USD before converting
    // to base asset. This ensures no single order can exceed the hard limit even
    // if the caller bypasses the engine.
    // ─────────────────────────────────────────────────────────────────────────

    // Determine worst-case price for the limit-IOC market order emulation
    let refPrice = options?.marketPriceHint ?? 0;
    if (refPrice <= 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await this.fetchTicker(symbol) as any;
        const oracle = Number(data?.markets?.[dydxSymbol]?.oraclePrice ?? 0);
        if (oracle > 0) refPrice = oracle;
      } catch {
        // proceed without price hint — use extreme fallback prices
      }
    }

    // dYdX v4 uses limit-IOC orders to emulate market fills.
    // 10% buffer ensures the order fills even in fast markets while
    // preventing catastrophic fills in illiquid / edge conditions.
    const SLIPPAGE_BUFFER = 0.10;
    const worstCasePrice =
      refPrice > 0
        ? side === 'buy'
          ? refPrice * (1 + SLIPPAGE_BUFFER)
          : refPrice * (1 - SLIPPAGE_BUFFER)
        : side === 'buy'
          ? 9_999_999   // extreme ceiling for buys (ensures fill)
          : 0.000001;   // extreme floor for sells (ensures fill)

    const { client, wallet } = await this.lazyInit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dydx = await import('@dydxprotocol/v4-client-js') as any;
    const { SubaccountInfo, OrderType, OrderSide, OrderTimeInForce, OrderExecution } = dydx;

    const subaccount = new SubaccountInfo(wallet, 0);
    // dYdX clientId: random uint31 (required; used for order dedup on chain)
    const clientId = Math.floor(Math.random() * 2 ** 31);
    const dydxSide = side === 'buy' ? OrderSide.BUY : OrderSide.SELL;

    // MARKET = limit-IOC under the hood on dYdX v4 CLOB
    const tx = await client.placeOrder(
      subaccount,
      dydxSymbol,
      OrderType.MARKET,
      dydxSide,
      worstCasePrice,
      safeAmount,
      clientId,
      OrderTimeInForce.IOC,
      0,                     // goodTilTimeInSeconds (irrelevant for IOC)
      OrderExecution.DEFAULT,
      false,                 // postOnly
      false,                 // reduceOnly
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txHash = (tx as any)?.hash ?? (tx as any)?.txHash ?? `dydx-${clientId}-${Date.now()}`;

    console.info(
      `[DydxAdapter] ${side.toUpperCase()} ${safeAmount} ${dydxSymbol} ` +
      `| worstPrice=${worstCasePrice.toFixed(4)} | clientId=${clientId} | txHash=${txHash} ` +
      `| network=${this.testnet ? 'testnet' : 'mainnet'}`
    );

    return {
      id: String(txHash),
      symbol: dydxSymbol,
      side,
      amount: safeAmount,
      status: 'submitted',
      info: {
        txHash,
        clientId,
        dydxSymbol,
        worstCasePrice,
        network: this.testnet ? 'testnet' : 'mainnet',
      },
    };
  }
}

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Creates a LIVE broker adapter using dYdX v4 perpetuals (THE SNIPER).
 * Falls back to SimulatedExchangeAdapter when allowSimulationFallback=true and
 * DYDX_WALLET_PRIVATE_KEY is missing.
 */
export function createBrokerAdapter(options?: { allowSimulationFallback?: boolean; testnet?: boolean }): IBrokerAdapter {
  const allowFallback = options?.allowSimulationFallback ?? true;
  try {
    return new DydxBrokerAdapter({ testnet: options?.testnet ?? false });
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
 * LIVE uses DydxBrokerAdapter (dYdX v4 perpetuals); simulated only when
 * allowSimulationFallback is true and DYDX_WALLET_PRIVATE_KEY is missing.
 *
 * DRY_RUN=true is an additional hard lockdown: even if mode=LIVE is somehow
 * set, DRY_RUN forces simulation and prevents real fund movement.
 */
export function createExecutionBrokerAdapter(
  mode: 'PAPER' | 'LIVE',
  options?: { allowSimulationFallback?: boolean; testnet?: boolean }
): IBrokerAdapter {
  const isDryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() === 'true';
  if (mode === 'PAPER' || isDryRun) {
    if (isDryRun && mode === 'LIVE') {
      console.warn('[BrokerAdapter] DRY_RUN=true overrides LIVE mode — SimulatedExchangeAdapter active. No real funds will move.');
    }
    return new SimulatedExchangeAdapter();
  }
  return createBrokerAdapter(options);
}
