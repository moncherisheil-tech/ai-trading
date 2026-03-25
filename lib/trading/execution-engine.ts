import { getAppSettings } from '@/lib/db/app-settings';
import { listOpenVirtualTrades, closeVirtualTrade, type VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';
import {
  insertVirtualTradeHistory,
  hasVirtualTradeExecutionEvent,
  listVirtualTradeHistory,
  getLatestExecutedBuyForVirtualTrade,
  type ExecutionMode,
  type ExecutionSignalSide,
} from '@/lib/db/virtual-trades-history';
import { fetchBinanceTickerPrices, fetchBinanceMarkPrices } from '@/lib/api-utils';
import { applySlippage, round2, toDecimal } from '@/lib/decimal';
import { openVirtualTrade, getVirtualPortfolioSummary } from '@/lib/simulation-service';
import {
  MAX_OPEN_POSITIONS,
  assertOpenPositionsLimit,
  assertTradeRiskWithinLimit,
  calculatePositionSize,
  calculateTradeLevels,
} from '@/lib/trading/risk-manager';
import { createBrokerAdapter, type BrokerOrderSide } from '@/lib/trading/broker-adapter';
import { StealthExecutionEngine } from '@/lib/trading/stealth-execution';
import { ReinforcementEngine } from '@/lib/trading/reinforcement-learning';
import { dispatchCriticalAlert, type AlertSeverity } from '@/lib/ops/alert-dispatcher';

const INITIAL_VIRTUAL_BALANCE_USD = 10_000;
const DEFAULT_TWAP_DURATION_MINUTES = 1;
const DEFAULT_TWAP_CHUNKS = 4;

export interface AutonomousExecutionInput {
  predictionId: string;
  symbol: string;
  predictedDirection: 'Bullish' | 'Bearish' | 'Neutral';
  finalConfidence: number;
  marketVolatility?: number;
  consensusApproved: boolean;
  consensusReasoning?: {
    overseerSummary?: string;
    overseerReasoningPath?: string;
    expertBreakdown?: Record<string, unknown>;
  };
}

export interface AutonomousExecutionResult {
  eventId: string;
  mode: ExecutionMode;
  signal: ExecutionSignalSide | null;
  executed: boolean;
  status: 'executed' | 'blocked' | 'skipped' | 'failed';
  reason: string;
  virtualTradeId?: number;
}

export interface ExecutionDashboardSnapshot {
  mode: ExecutionMode;
  masterSwitchEnabled: boolean;
  minConfidenceToExecute: number;
  liveApiKeyConfigured: boolean;
  liveLocked: boolean;
  virtualBalanceUsd: number;
  winRatePct: number;
  activeTradesCount: number;
  activeTrades: Array<{
    id: number;
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    amountUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
    analysisReasoning: {
      reason: string | null;
      overseerSummary: string | null;
      overseerReasoningPath: string | null;
      expertBreakdown: Record<string, unknown> | null;
      createdAt: string | null;
    } | null;
  }>;
  recentExecutions: Array<{
    id: number;
    symbol: string;
    signal: ExecutionSignalSide;
    confidence: number;
    mode: ExecutionMode;
    status: string;
    executed: boolean;
    reason: string | null;
    overseerSummary: string | null;
    overseerReasoningPath: string | null;
    expertBreakdown: Record<string, unknown> | null;
    executionPrice: number | null;
    amountUsd: number | null;
    virtualTradeId: number | null;
    createdAt: string;
  }>;
}

function mapSignalToBrokerSide(signal: ExecutionSignalSide): BrokerOrderSide {
  return signal === 'BUY' ? 'buy' : 'sell';
}

function roundAmount(value: number, precision = 8): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function mapDirectionToSignal(direction: AutonomousExecutionInput['predictedDirection']): ExecutionSignalSide | null {
  if (direction === 'Bullish') return 'BUY';
  if (direction === 'Bearish') return 'SELL';
  return null;
}

function normalizeSymbol(raw: string): string {
  const clean = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.endsWith('USDT') ? clean : `${clean}USDT`;
}

function getRiskModeMultiplier(level: 'strict' | 'moderate' | 'aggressive' | undefined): number {
  if (level === 'aggressive') return 1.3;
  if (level === 'moderate') return 1;
  return 0.7;
}

function safeJsonParse(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function dispatchTradeBlockedAlert(symbol: string, reason: string): Promise<void> {
  const normalized = reason.toLowerCase();
  const severity: AlertSeverity =
    normalized.includes('risk violation') || normalized.includes('rejected') ? 'CRITICAL' : 'WARNING';
  await dispatchCriticalAlert('Trade Aborted by Risk Manager', `${symbol}: ${reason}`, severity);
}

async function dispatchTwapSuccessAlert(symbol: string, signal: ExecutionSignalSide, reason: string): Promise<void> {
  await dispatchCriticalAlert(
    `TWAP Execution Completed (${signal})`,
    `${symbol}: ${reason}`,
    'SUCCESS'
  );
}

export async function executeAutonomousConsensusSignal(
  input: AutonomousExecutionInput
): Promise<AutonomousExecutionResult> {
  const signal = mapDirectionToSignal(input.predictedDirection);
  const symbol = normalizeSymbol(input.symbol);
  const eventId = `${input.predictionId}:${signal ?? 'NONE'}`;
  const settings = await getAppSettings();
  const execution = settings.execution;
  const mode = execution.mode ?? 'PAPER';
  const minConfidence = execution.minConfidenceToExecute ?? 80;
  const riskLevel = settings.risk?.riskToleranceLevel ?? 'strict';
  const baseAmountUsd = settings.risk.defaultPositionSizeUsd ?? settings.trading.defaultTradeSizeUsd ?? 100;
  const desiredAmountUsd = round2(baseAmountUsd * getRiskModeMultiplier(riskLevel));
  const expertBreakdownJson =
    input.consensusReasoning?.expertBreakdown != null
      ? JSON.stringify(input.consensusReasoning.expertBreakdown)
      : null;

  if (!signal) {
    const reason = 'Direction is neutral; no autonomous action.';
    return { eventId, mode, signal: null, executed: false, status: 'skipped', reason };
  }

  if (await hasVirtualTradeExecutionEvent(eventId)) {
    return {
      eventId,
      mode,
      signal,
      executed: false,
      status: 'skipped',
      reason: 'Execution event already processed.',
    };
  }

  if (!execution.masterSwitchEnabled) {
    const reason = 'Autonomous execution master switch is OFF.';
    await insertVirtualTradeHistory({
      eventId,
      predictionId: input.predictionId,
      symbol,
      signalSide: signal,
      confidence: input.finalConfidence,
      mode,
      executed: false,
      executionStatus: 'blocked',
      reason,
      overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
      overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
      expertBreakdownJson,
    });
    await dispatchTradeBlockedAlert(symbol, reason);
    return { eventId, mode, signal, executed: false, status: 'blocked', reason };
  }

  if (!input.consensusApproved || input.finalConfidence < minConfidence) {
    const reason = `Confidence ${input.finalConfidence.toFixed(1)} below execution threshold ${minConfidence.toFixed(1)}.`;
    await insertVirtualTradeHistory({
      eventId,
      predictionId: input.predictionId,
      symbol,
      signalSide: signal,
      confidence: input.finalConfidence,
      mode,
      executed: false,
      executionStatus: 'skipped',
      reason,
      overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
      overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
      expertBreakdownJson,
    });
    return { eventId, mode, signal, executed: false, status: 'skipped', reason };
  }

  const effectiveMode: ExecutionMode = mode === 'LIVE' ? 'LIVE' : 'PAPER';

  try {
    const prices = await fetchBinanceTickerPrices([symbol], 10_000);
    const livePrice = prices.get(symbol);
    if (!Number.isFinite(livePrice) || (livePrice ?? 0) <= 0) {
      const reason = 'Live Binance execution price unavailable.';
      await insertVirtualTradeHistory({
        eventId,
        predictionId: input.predictionId,
        symbol,
        signalSide: signal,
        confidence: input.finalConfidence,
        mode: effectiveMode,
        executed: false,
        executionStatus: 'failed',
        reason,
        overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
        overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
        expertBreakdownJson,
      });
      return { eventId, mode: effectiveMode, signal, executed: false, status: 'failed', reason };
    }

    const openTrades = await listOpenVirtualTrades();
    const openForSymbol = openTrades.find((t) => t.symbol === symbol);

    if (signal === 'BUY') {
      const configuredMaxOpen = Math.max(1, Number(settings.trading.maxOpenPositions ?? MAX_OPEN_POSITIONS));
      const maxOpenPositions = Math.min(MAX_OPEN_POSITIONS, configuredMaxOpen);
      try {
        assertOpenPositionsLimit(openTrades.length);
      } catch {
        const reason = `Risk limit blocked BUY: open positions ${openTrades.length}/${maxOpenPositions}.`;
        await insertVirtualTradeHistory({
          eventId,
          predictionId: input.predictionId,
          symbol,
          signalSide: signal,
          confidence: input.finalConfidence,
          mode: effectiveMode,
          executed: false,
          executionStatus: 'blocked',
          reason,
          overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
          overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
          expertBreakdownJson,
          executionPrice: livePrice,
        });
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }
      if (openTrades.length >= maxOpenPositions) {
        const reason = `Risk limit blocked BUY: open positions ${openTrades.length}/${maxOpenPositions}.`;
        await insertVirtualTradeHistory({
          eventId,
          predictionId: input.predictionId,
          symbol,
          signalSide: signal,
          confidence: input.finalConfidence,
          mode: effectiveMode,
          executed: false,
          executionStatus: 'blocked',
          reason,
          overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
          overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
          expertBreakdownJson,
          executionPrice: livePrice,
        });
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }

      if (openForSymbol) {
        const reason = 'Open position already exists for symbol.';
        await insertVirtualTradeHistory({
          eventId,
          predictionId: input.predictionId,
          symbol,
          signalSide: signal,
          confidence: input.finalConfidence,
          mode: effectiveMode,
          executed: false,
          executionStatus: 'skipped',
          reason,
          overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
          overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
          expertBreakdownJson,
          executionPrice: livePrice,
          amountUsd: openForSymbol.amount_usd,
          virtualTradeId: openForSymbol.id,
        });
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'skipped', reason };
      }

      const summary = await getVirtualPortfolioSummary();
      const totalOpenExposureUsd = openTrades.reduce((sum, t) => sum + t.amount_usd, 0);
      const openExposureForSymbolUsd = openTrades
        .filter((t) => t.symbol === symbol)
        .reduce((sum, t) => sum + t.amount_usd, 0);
      const virtualEquityUsd = Math.max(1, INITIAL_VIRTUAL_BALANCE_USD + summary.totalRealizedPnlUsd);
      const marketVolatility = Number.isFinite(input.marketVolatility) ? Math.max(0, input.marketVolatility ?? 0) : 3;
      const sizing = calculatePositionSize(virtualEquityUsd, input.finalConfidence, marketVolatility);
      if (sizing.rejected || sizing.positionSizeUsd <= 0) {
        const reason = `Risk manager rejected position sizing: ${sizing.reason}`;
        await insertVirtualTradeHistory({
          eventId,
          predictionId: input.predictionId,
          symbol,
          signalSide: signal,
          confidence: input.finalConfidence,
          mode: effectiveMode,
          executed: false,
          executionStatus: 'blocked',
          reason,
          overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
          overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
          expertBreakdownJson,
          executionPrice: livePrice,
        });
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }
      const globalExposureCapUsd = (virtualEquityUsd * Math.max(0, settings.risk.globalMaxExposurePct ?? 70)) / 100;
      const singleAssetCapUsd =
        (virtualEquityUsd * Math.max(0, settings.risk.singleAssetConcentrationLimitPct ?? 20)) / 100;
      const availableGlobalUsd = Math.max(0, round2(globalExposureCapUsd - totalOpenExposureUsd));
      const availableSingleAssetUsd = Math.max(0, round2(singleAssetCapUsd - openExposureForSymbolUsd));
      const amountUsd = Math.max(0, round2(Math.min(desiredAmountUsd, sizing.positionSizeUsd, availableGlobalUsd, availableSingleAssetUsd)));

      if (amountUsd <= 0) {
        const reason = `Risk limit blocked BUY: desired ${desiredAmountUsd.toFixed(
          2
        )} USD, global available ${availableGlobalUsd.toFixed(
          2
        )} USD, symbol available ${availableSingleAssetUsd.toFixed(2)} USD.`;
        await insertVirtualTradeHistory({
          eventId,
          predictionId: input.predictionId,
          symbol,
          signalSide: signal,
          confidence: input.finalConfidence,
          mode: effectiveMode,
          executed: false,
          executionStatus: 'blocked',
          reason,
          overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
          overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
          expertBreakdownJson,
          executionPrice: livePrice,
          amountUsd: desiredAmountUsd,
        });
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }

      const entryPrice = applySlippage(livePrice, 'buy', 5);
      const dynamicLevels = calculateTradeLevels(entryPrice, marketVolatility, 'LONG');
      const targetProfitPct = round2(((dynamicLevels.takeProfit - entryPrice) / entryPrice) * 100);
      const stopLossPct = -Math.abs(round2(((entryPrice - dynamicLevels.stopLoss) / entryPrice) * 100));
      assertTradeRiskWithinLimit({
        accountBalance: virtualEquityUsd,
        positionSizeUsd: amountUsd,
        entryPrice,
        stopLoss: dynamicLevels.stopLoss,
      });
      const opened = await openVirtualTrade({
        symbol,
        entry_price: entryPrice,
        amount_usd: amountUsd,
        target_profit_pct: targetProfitPct,
        stop_loss_pct: stopLossPct,
        source: 'agent',
      });
      if (!opened.success) {
        const reason = opened.error || 'Failed to open virtual trade.';
        await insertVirtualTradeHistory({
          eventId,
          predictionId: input.predictionId,
          symbol,
          signalSide: signal,
          confidence: input.finalConfidence,
          mode: effectiveMode,
          executed: false,
          executionStatus: 'failed',
          reason,
          overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
          overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
          expertBreakdownJson,
          executionPrice: entryPrice,
          amountUsd,
        });
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'failed', reason };
      }

      const broker = createBrokerAdapter({
        allowSimulationFallback: true,
        testnet: process.env.EXCHANGE_TESTNET === 'true',
      });
      const stealth = new StealthExecutionEngine(broker);
      const totalAssetAmount = roundAmount(amountUsd / Math.max(livePrice, 0.00000001), 8);
      const twapResult = await stealth.executeTWAP(
        symbol,
        mapSignalToBrokerSide(signal),
        totalAssetAmount,
        DEFAULT_TWAP_DURATION_MINUTES,
        DEFAULT_TWAP_CHUNKS
      );
      const executionLabel = broker.isSimulated ? 'Simulated TWAP BUY executed.' : 'TWAP BUY executed via exchange.';

      await insertVirtualTradeHistory({
        eventId,
        predictionId: input.predictionId,
        symbol,
        signalSide: signal,
        confidence: input.finalConfidence,
        mode: effectiveMode,
        executed: true,
        executionStatus: 'executed',
        reason: `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(
          twapResult.intervalMs
        )}. Risk mode=${riskLevel}, TP=${targetProfitPct.toFixed(2)}%, SL=${stopLossPct.toFixed(
          2
        )}%, sizing=${sizing.riskFraction.toFixed(4)}.`,
        overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
        overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
        expertBreakdownJson,
        executionPrice: entryPrice,
        amountUsd,
        virtualTradeId: opened.id,
      });
      await dispatchTwapSuccessAlert(
        symbol,
        signal,
        `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(twapResult.intervalMs)}.`
      );
      return {
        eventId,
        mode: effectiveMode,
        signal,
        executed: true,
        status: 'executed',
        reason: `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(
          twapResult.intervalMs
        )}. Risk mode=${riskLevel}, TP=${targetProfitPct.toFixed(2)}%, SL=${stopLossPct.toFixed(
          2
        )}%, sizing=${sizing.riskFraction.toFixed(4)}.`,
        virtualTradeId: opened.id,
      };
    }

    if (!openForSymbol) {
      const reason = 'No open position found for SELL signal.';
      await insertVirtualTradeHistory({
        eventId,
        predictionId: input.predictionId,
        symbol,
        signalSide: signal,
        confidence: input.finalConfidence,
        mode: effectiveMode,
        executed: false,
        executionStatus: 'skipped',
        reason,
        overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
        overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
        expertBreakdownJson,
        executionPrice: livePrice,
      });
      return { eventId, mode: effectiveMode, signal, executed: false, status: 'skipped', reason };
    }

    const broker = createBrokerAdapter({
      allowSimulationFallback: true,
      testnet: process.env.EXCHANGE_TESTNET === 'true',
    });
    const stealth = new StealthExecutionEngine(broker);
    const totalAssetAmount = roundAmount(openForSymbol.amount_usd / Math.max(openForSymbol.entry_price, 0.00000001), 8);
    const twapResult = await stealth.executeTWAP(
      symbol,
      mapSignalToBrokerSide(signal),
      totalAssetAmount,
      DEFAULT_TWAP_DURATION_MINUTES,
      DEFAULT_TWAP_CHUNKS
    );
    const exitPrice = applySlippage(livePrice, 'sell', 5);
    const closeResult = await closeVirtualTrade(openForSymbol.id, exitPrice, 'manual');
    const openingBuyEvent = await getLatestExecutedBuyForVirtualTrade(openForSymbol.id);
    const originalExpertBreakdownJson = openingBuyEvent?.expert_breakdown_json ?? expertBreakdownJson;
    const executionLabel = broker.isSimulated ? 'Simulated TWAP SELL executed.' : 'TWAP SELL executed via exchange.';
    await insertVirtualTradeHistory({
      eventId,
      predictionId: input.predictionId,
      symbol,
      signalSide: signal,
      confidence: input.finalConfidence,
      mode: effectiveMode,
      executed: true,
      executionStatus: 'executed',
      reason: `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(twapResult.intervalMs)}.`,
      overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
      overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
      expertBreakdownJson: originalExpertBreakdownJson,
      executionPrice: exitPrice,
      amountUsd: openForSymbol.amount_usd,
      pnlNetUsd: closeResult?.pnlNetUsd ?? null,
      virtualTradeId: openForSymbol.id,
    });
    await dispatchTwapSuccessAlert(
      symbol,
      signal,
      `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(twapResult.intervalMs)}.`
    );
    void new ReinforcementEngine().evaluateRecentTrades().catch((err) => {
      console.warn(
        '[ReinforcementEngine] Failed to evaluate recent trades:',
        err instanceof Error ? err.message : String(err)
      );
    });
    return {
      eventId,
      mode: effectiveMode,
      signal,
      executed: true,
      status: 'executed',
      reason: `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(twapResult.intervalMs)}.`,
      virtualTradeId: openForSymbol.id,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Execution engine failure.';
    await insertVirtualTradeHistory({
      eventId,
      predictionId: input.predictionId,
      symbol,
      signalSide: signal,
      confidence: input.finalConfidence,
      mode: effectiveMode,
      executed: false,
      executionStatus: 'failed',
      reason,
      overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
      overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
      expertBreakdownJson,
    });
    return { eventId, mode: effectiveMode, signal, executed: false, status: 'failed', reason };
  }
}

function computeUnrealized(trade: VirtualPortfolioRow, currentPrice: number): { usd: number; pct: number } {
  const entry = toDecimal(trade.entry_price);
  if (entry.lte(0)) return { usd: 0, pct: 0 };
  const amountAsset = toDecimal(trade.amount_usd).div(entry);
  const pnlUsd = toDecimal(currentPrice).minus(entry).times(amountAsset);
  const pct = pnlUsd.div(trade.amount_usd).times(100);
  return { usd: round2(pnlUsd), pct: round2(pct) };
}

export async function getExecutionDashboardSnapshot(): Promise<ExecutionDashboardSnapshot> {
  const settings = await getAppSettings();
  const execution = settings.execution;
  const mode: ExecutionMode = execution.mode ?? 'PAPER';
  const liveReady = Boolean(execution.liveApiKeyConfigured);
  const [summary, openTrades, history] = await Promise.all([
    getVirtualPortfolioSummary(),
    listOpenVirtualTrades(),
    listVirtualTradeHistory(120),
  ]);

  const symbols = openTrades.map((t) => t.symbol);
  const [markPrices, tickerPrices] = symbols.length > 0
    ? await Promise.all([fetchBinanceMarkPrices(symbols, 8_000), fetchBinanceTickerPrices(symbols, 8_000)])
    : [new Map<string, number>(), new Map<string, number>()];
  let totalUnrealizedPnlUsd = 0;
  const tradeReasoningByVirtualTradeId = new Map<number, (typeof history)[number]>();
  for (const h of history) {
    if (h.virtual_trade_id == null || tradeReasoningByVirtualTradeId.has(h.virtual_trade_id)) continue;
    tradeReasoningByVirtualTradeId.set(h.virtual_trade_id, h);
  }
  const activeTrades = openTrades.map((t) => {
    const currentPrice = markPrices.get(t.symbol) ?? tickerPrices.get(t.symbol) ?? t.entry_price;
    const unrealized = computeUnrealized(t, currentPrice);
    totalUnrealizedPnlUsd += unrealized.usd;
    const reasonRow = tradeReasoningByVirtualTradeId.get(t.id) ?? null;
    return {
      id: t.id,
      symbol: t.symbol,
      entryPrice: t.entry_price,
      currentPrice,
      amountUsd: t.amount_usd,
      unrealizedPnlUsd: unrealized.usd,
      unrealizedPnlPct: unrealized.pct,
      analysisReasoning: reasonRow
        ? {
            reason: reasonRow.reason,
            overseerSummary: reasonRow.overseer_summary,
            overseerReasoningPath: reasonRow.overseer_reasoning_path,
            expertBreakdown: safeJsonParse(reasonRow.expert_breakdown_json),
            createdAt: reasonRow.created_at,
          }
        : null,
    };
  });

  const virtualBalanceUsd = round2(INITIAL_VIRTUAL_BALANCE_USD + summary.totalRealizedPnlUsd + totalUnrealizedPnlUsd);

  return {
    mode,
    masterSwitchEnabled: Boolean(execution.masterSwitchEnabled),
    minConfidenceToExecute: execution.minConfidenceToExecute ?? 80,
    liveApiKeyConfigured: liveReady,
    liveLocked: !liveReady,
    virtualBalanceUsd,
    winRatePct: round2(summary.winRatePct),
    activeTradesCount: activeTrades.length,
    activeTrades,
    recentExecutions: history.map((h) => ({
      id: h.id,
      symbol: h.symbol,
      signal: h.signal_side,
      confidence: h.confidence,
      mode: h.mode,
      status: h.execution_status,
      executed: h.executed,
      reason: h.reason,
      overseerSummary: h.overseer_summary,
      overseerReasoningPath: h.overseer_reasoning_path,
      expertBreakdown: safeJsonParse(h.expert_breakdown_json),
      executionPrice: h.execution_price,
      amountUsd: h.amount_usd,
      virtualTradeId: h.virtual_trade_id,
      createdAt: h.created_at,
    })),
  };
}
