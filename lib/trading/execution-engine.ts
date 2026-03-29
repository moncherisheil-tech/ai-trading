import { getAppSettings } from '@/lib/db/app-settings';
import { generateSafeId } from '@/lib/utils';
import { listOpenVirtualTrades, listClosedVirtualTrades, closeVirtualTrade, type VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';
import {
  insertVirtualTradeHistory,
  hasVirtualTradeExecutionEvent,
  tryClaimExecutionPipeline,
  listVirtualTradeHistory,
  getLatestExecutedBuyForVirtualTrade,
  type ExecutionMode,
  type ExecutionSignalSide,
} from '@/lib/db/virtual-trades-history';
import { fetchBinanceTickerPrices, fetchBinanceMarkPrices, fetchBinanceOrderBookDepth } from '@/lib/api-utils';
import { applySlippage, round2, toDecimal } from '@/lib/decimal';
import { openVirtualTrade, getVirtualPortfolioSummary } from '@/lib/simulation-service';
import {
  MAX_OPEN_POSITIONS,
  assertOpenPositionsLimit,
  assertTradeRiskWithinLimit,
  calculatePositionSize,
  computeKellyPositionUsd,
} from '@/lib/trading/risk-manager';
import {
  estimateBuySlippageFraction,
  estimateSellSlippageFraction,
  pickTwapSchedule,
  shouldUseStealthTwap,
} from '@/lib/trading/execution-liquidity';
import { buildScalpExecutionPlan, inferScalpTierFromVolatility } from '@/lib/trading/scalp-tiers';
import { createExecutionBrokerAdapter, type BrokerOrderSide } from '@/lib/trading/broker-adapter';
import { StealthExecutionEngine } from '@/lib/trading/stealth-execution';
import { ReinforcementEngine } from '@/lib/trading/reinforcement-learning';
import { dispatchCriticalAlert, type AlertSeverity } from '@/lib/ops/alert-dispatcher';
import ccxt from 'ccxt';
import { insertTradeExecution, markTradeExecutionFailed, type TradeExecutionRow } from '@/lib/db/execution-learning';

const INITIAL_VIRTUAL_BALANCE_USD = 10_000;

export interface AutonomousExecutionInput {
  predictionId: string;
  decisionId?: string;
  idempotencyKey?: string;
  priority?: 'atomic' | 'standard';
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

export interface AlphaEvolutionPoint {
  closedAt: string;
  cumulativePnlUsd: number;
  rollingWinRatePct: number;
}

function buildAlphaEvolutionCurve(closed: VirtualPortfolioRow[], rollingWindow = 10): AlphaEvolutionPoint[] {
  const sorted = [...closed]
    .filter((c) => c.closed_at && c.status === 'closed')
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());
  let cum = 0;
  const outcomes: boolean[] = [];
  const out: AlphaEvolutionPoint[] = [];
  for (const t of sorted) {
    const pnlUsd =
      t.pnl_net_usd != null && Number.isFinite(Number(t.pnl_net_usd))
        ? Number(t.pnl_net_usd)
        : (t.amount_usd * (t.pnl_pct ?? 0)) / 100;
    cum += pnlUsd;
    const won = (t.pnl_pct ?? 0) > 0;
    outcomes.push(won);
    if (outcomes.length > rollingWindow) outcomes.shift();
    const wr = outcomes.length ? (outcomes.filter(Boolean).length / outcomes.length) * 100 : 0;
    out.push({
      closedAt: t.closed_at!,
      cumulativePnlUsd: round2(cum),
      rollingWinRatePct: round2(wr),
    });
  }
  return out;
}

export interface ExecutionDashboardSnapshot {
  mode: ExecutionMode;
  masterSwitchEnabled: boolean;
  minConfidenceToExecute: number;
  liveApiKeyConfigured: boolean;
  liveLocked: boolean;
  goLiveSafetyAcknowledged: boolean;
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
    /** Virtual book: TP/SL as % from entry; prices derived for long-style display. */
    targetProfitPct: number;
    stopLossPct: number;
    takeProfitPrice: number;
    stopLossPrice: number;
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
  /** Cumulative realized PnL vs rolling win rate over last N closed paper trades. */
  alphaEvolution: AlphaEvolutionPoint[];
  /** Last פיקוד ↔ רובוט handshake (from app settings). */
  robotHandshakeAt: string | null;
  robotHandshakeSource: 'telegram' | 'dashboard' | null;
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

function duplicateExecutionSkip(
  eventId: string,
  mode: ExecutionMode,
  signal: ExecutionSignalSide | null
): AutonomousExecutionResult {
  return {
    eventId,
    mode,
    signal,
    executed: false,
    status: 'skipped',
    reason: 'Execution event already processed.',
  };
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
  const rawKey = input.idempotencyKey?.trim();
  const eventId = rawKey
    ? `idem:${rawKey.slice(0, 200)}`
    : `auto:${input.predictionId}:${signal ?? 'NONE'}:${input.decisionId ?? 'no-decision-id'}`;
  const priority = input.priority === 'atomic' ? 'atomic' : 'standard';
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
    const ins = await insertVirtualTradeHistory({
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
    if (!ins.inserted) return duplicateExecutionSkip(eventId, mode, signal);
    await dispatchTradeBlockedAlert(symbol, reason);
    return { eventId, mode, signal, executed: false, status: 'blocked', reason };
  }

  if (!input.consensusApproved || input.finalConfidence < minConfidence) {
    const reason = `Confidence ${input.finalConfidence.toFixed(1)} below execution threshold ${minConfidence.toFixed(1)}.`;
    const ins = await insertVirtualTradeHistory({
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
    if (!ins.inserted) return duplicateExecutionSkip(eventId, mode, signal);
    return { eventId, mode, signal, executed: false, status: 'skipped', reason };
  }

  const effectiveMode: ExecutionMode = mode === 'LIVE' ? 'LIVE' : 'PAPER';

  try {
    const prices = await fetchBinanceTickerPrices([symbol], 10_000);
    const livePrice = prices.get(symbol);
    if (!Number.isFinite(livePrice) || (livePrice ?? 0) <= 0) {
      const reason = 'Live Binance execution price unavailable.';
      const ins = await insertVirtualTradeHistory({
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
      if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
      return { eventId, mode: effectiveMode, signal, executed: false, status: 'failed', reason };
    }

    const openTrades = await listOpenVirtualTrades();
    const openForSymbol = openTrades.find((t) => t.symbol === symbol);

    if (signal === 'BUY') {
      const depthPrefetch = fetchBinanceOrderBookDepth(symbol, 50, 10_000);
      const configuredMaxOpen = Math.max(1, Number(settings.trading.maxOpenPositions ?? MAX_OPEN_POSITIONS));
      const maxOpenPositions = Math.min(MAX_OPEN_POSITIONS, configuredMaxOpen);
      try {
        assertOpenPositionsLimit(openTrades.length);
      } catch {
        const reason = `Risk limit blocked BUY: open positions ${openTrades.length}/${maxOpenPositions}.`;
        const ins = await insertVirtualTradeHistory({
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
        if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }
      if (openTrades.length >= maxOpenPositions) {
        const reason = `Risk limit blocked BUY: open positions ${openTrades.length}/${maxOpenPositions}.`;
        const ins = await insertVirtualTradeHistory({
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
        if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }

      if (openForSymbol) {
        const reason = 'Open position already exists for symbol.';
        const ins = await insertVirtualTradeHistory({
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
        if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
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
        const ins = await insertVirtualTradeHistory({
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
        if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }
      const globalExposureCapUsd = (virtualEquityUsd * Math.max(0, settings.risk.globalMaxExposurePct ?? 70)) / 100;
      const singleAssetCapUsd =
        (virtualEquityUsd * Math.max(0, settings.risk.singleAssetConcentrationLimitPct ?? 20)) / 100;
      const availableGlobalUsd = Math.max(0, round2(globalExposureCapUsd - totalOpenExposureUsd));
      const availableSingleAssetUsd = Math.max(0, round2(singleAssetCapUsd - openExposureForSymbolUsd));
      const kelly = computeKellyPositionUsd({
        accountBalance: virtualEquityUsd,
        overseerConfidencePct: input.finalConfidence,
        historicalWinRatePct: summary.winRatePct,
      });
      const amountUsd = Math.max(
        0,
        round2(
          Math.min(desiredAmountUsd, sizing.positionSizeUsd, kelly.positionUsd, availableGlobalUsd, availableSingleAssetUsd)
        )
      );

      if (amountUsd <= 0) {
        const reason = `Risk limit blocked BUY: desired ${desiredAmountUsd.toFixed(
          2
        )} USD, global available ${availableGlobalUsd.toFixed(
          2
        )} USD, symbol available ${availableSingleAssetUsd.toFixed(2)} USD.`;
        const ins = await insertVirtualTradeHistory({
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
        if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
        await dispatchTradeBlockedAlert(symbol, reason);
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'blocked', reason };
      }

      const pipelineClaimed = await tryClaimExecutionPipeline(eventId);
      if (!pipelineClaimed) {
        return duplicateExecutionSkip(eventId, effectiveMode, signal);
      }

      const entryPrice = applySlippage(livePrice, 'buy', 5);
      const scalpTier = inferScalpTierFromVolatility(marketVolatility);
      const scalpPlan = buildScalpExecutionPlan(symbol, scalpTier, input.finalConfidence);
      const targetProfitPct = round2(scalpPlan.targetProfitPct);
      const stopLossPct = round2(scalpPlan.stopLossPct);
      const stopLossPx = entryPrice * (1 + stopLossPct / 100);
      assertTradeRiskWithinLimit({
        accountBalance: virtualEquityUsd,
        positionSizeUsd: amountUsd,
        entryPrice,
        stopLoss: stopLossPx,
      });

      const depth = await depthPrefetch;
      const slipFrac = estimateBuySlippageFraction(depth, amountUsd, livePrice ?? entryPrice);
      const twapSched = pickTwapSchedule(shouldUseStealthTwap(slipFrac));

      const enrichedBreakdown = JSON.stringify({
        ...(safeJsonParse(expertBreakdownJson) ?? {}),
        protocolOmega: {
          scalpTier: scalpPlan.tier,
          holdTimeMinutes: scalpPlan.holdTimeMinutes,
          targetProfitPct: scalpPlan.targetProfitPct,
          stopLossPct: scalpPlan.stopLossPct,
          aiConfidenceScore: scalpPlan.aiConfidenceScore,
          kellyFraction: kelly.kellyFraction,
          kellyNote: kelly.note,
          estSlippagePct: round2(slipFrac * 1000) / 10,
          twapMinutes: twapSched.durationMinutes,
          twapChunks: twapSched.chunks,
        },
      });

      /** Persist tactical state in JSONB `exec_state` so trailing-stop / sim logic keeps Kelly + tier after restart. */
      const opened = await openVirtualTrade({
        symbol,
        entry_price: entryPrice,
        amount_usd: amountUsd,
        target_profit_pct: targetProfitPct,
        stop_loss_pct: stopLossPct,
        source: 'agent',
        exec_state: {
          peakUnrealizedPct: 0,
          effectiveStopLossPct: stopLossPct,
          kellyFraction: kelly.kellyFraction,
          scalpTier: scalpPlan.tier,
        },
      });
      if (!opened.success) {
        const reason = opened.error || 'Failed to open virtual trade.';
        const ins = await insertVirtualTradeHistory({
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
        if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
        await dispatchCriticalAlert(
          'Execution Engine — Virtual Trade Open Failed',
          `${symbol}: ${reason}`,
          'CRITICAL'
        );
        return { eventId, mode: effectiveMode, signal, executed: false, status: 'failed', reason };
      }

      const broker = createExecutionBrokerAdapter(effectiveMode, {
        allowSimulationFallback: true,
        testnet: process.env.EXCHANGE_TESTNET === 'true',
      });
      const stealth = new StealthExecutionEngine(broker);
      const priceForSize = livePrice ?? entryPrice;
      const totalAssetAmount = roundAmount(amountUsd / Math.max(priceForSize, 0.00000001), 8);
      const twapIdem = eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'twap';
      const twapResult = await stealth.executeTWAP(
        symbol,
        mapSignalToBrokerSide(signal),
        totalAssetAmount,
        twapSched.durationMinutes,
        twapSched.chunks,
        { idempotencyKeyPrefix: `${twapIdem}-buy` }
      );
      const executionLabel = broker.isSimulated ? 'Simulated TWAP BUY executed.' : 'TWAP BUY executed via exchange.';

      const insExec = await insertVirtualTradeHistory({
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
        )}. Priority=${priority}. Tier=${scalpPlan.tier}, estSlip=${(slipFrac * 100).toFixed(3)}%, TWAP=${twapSched.durationMinutes}m/${twapSched.chunks}ch. Risk mode=${riskLevel}, TP=${targetProfitPct.toFixed(2)}%, SL=${stopLossPct.toFixed(
          2
        )}%, Kelly f=${kelly.kellyFraction.toFixed(4)}, volSizing=${sizing.riskFraction.toFixed(4)}.`,
        overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
        overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
        expertBreakdownJson: enrichedBreakdown,
        executionPrice: entryPrice,
        amountUsd,
        virtualTradeId: opened.id,
      });
      if (!insExec.inserted) {
        console.warn('[ExecutionEngine] TWAP completed but history row already exists for eventId=', eventId);
      }
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
        )}. Priority=${priority}. Tier=${scalpPlan.tier}, Kelly+TWAP institutional path.`,
        virtualTradeId: opened.id,
      };
    }

    if (!openForSymbol) {
      const reason = 'No open position found for SELL signal.';
      const ins = await insertVirtualTradeHistory({
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
      if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
      return { eventId, mode: effectiveMode, signal, executed: false, status: 'skipped', reason };
    }

    const sellClaimed = await tryClaimExecutionPipeline(eventId);
    if (!sellClaimed) {
      return duplicateExecutionSkip(eventId, effectiveMode, signal);
    }

    const broker = createExecutionBrokerAdapter(effectiveMode, {
      allowSimulationFallback: true,
      testnet: process.env.EXCHANGE_TESTNET === 'true',
    });
    const stealth = new StealthExecutionEngine(broker);
    const exitDepth = await fetchBinanceOrderBookDepth(symbol, 50, 10_000);
    const slipSell = estimateSellSlippageFraction(
      exitDepth,
      openForSymbol.amount_usd,
      livePrice ?? openForSymbol.entry_price
    );
    const twapSellSched = pickTwapSchedule(shouldUseStealthTwap(slipSell));
    const totalAssetAmount = roundAmount(openForSymbol.amount_usd / Math.max(openForSymbol.entry_price, 0.00000001), 8);
    const twapIdemSell = eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'twap';
    const twapResult = await stealth.executeTWAP(
      symbol,
      mapSignalToBrokerSide(signal),
      totalAssetAmount,
      twapSellSched.durationMinutes,
      twapSellSched.chunks,
      { idempotencyKeyPrefix: `${twapIdemSell}-sell` }
    );
    const exitPrice = applySlippage(livePrice, 'sell', 5);
    const closeResult = await closeVirtualTrade(openForSymbol.id, exitPrice, 'manual');
    const openingBuyEvent = await getLatestExecutedBuyForVirtualTrade(openForSymbol.id);
    const originalExpertBreakdownJson = openingBuyEvent?.expert_breakdown_json ?? expertBreakdownJson;
    const executionLabel = broker.isSimulated ? 'Simulated TWAP SELL executed.' : 'TWAP SELL executed via exchange.';
    const insSell = await insertVirtualTradeHistory({
      eventId,
      predictionId: input.predictionId,
      symbol,
      signalSide: signal,
      confidence: input.finalConfidence,
      mode: effectiveMode,
      executed: true,
      executionStatus: 'executed',
      reason: `${executionLabel} chunks=${twapResult.chunks}, intervalMs=${Math.round(twapResult.intervalMs)}. Priority=${priority}.`,
      overseerSummary: input.consensusReasoning?.overseerSummary ?? null,
      overseerReasoningPath: input.consensusReasoning?.overseerReasoningPath ?? null,
      expertBreakdownJson: originalExpertBreakdownJson,
      executionPrice: exitPrice,
      amountUsd: openForSymbol.amount_usd,
      pnlNetUsd: closeResult?.pnlNetUsd ?? null,
      virtualTradeId: openForSymbol.id,
    });
    if (!insSell.inserted) {
      console.warn('[ExecutionEngine] SELL TWAP completed but history row already exists for eventId=', eventId);
    }
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
    const ins = await insertVirtualTradeHistory({
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
    if (!ins.inserted) return duplicateExecutionSkip(eventId, effectiveMode, signal);
    await dispatchCriticalAlert('PROTOCOL OMEGA — Execution Engine Exception', `${symbol}: ${reason}`, 'CRITICAL');
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
  const [summary, openTrades, history, closedTrades] = await Promise.all([
    getVirtualPortfolioSummary(),
    listOpenVirtualTrades(),
    listVirtualTradeHistory(120),
    listClosedVirtualTrades(400),
  ]);
  const alphaEvolution = buildAlphaEvolutionCurve(closedTrades, 10);

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
    const tpPct = t.target_profit_pct ?? 2;
    const slPct = t.stop_loss_pct ?? -1.5;
    const entry = t.entry_price;
    return {
      id: t.id,
      symbol: t.symbol,
      entryPrice: entry,
      currentPrice,
      amountUsd: t.amount_usd,
      unrealizedPnlUsd: unrealized.usd,
      unrealizedPnlPct: unrealized.pct,
      targetProfitPct: tpPct,
      stopLossPct: slPct,
      takeProfitPrice: round2(entry * (1 + tpPct / 100)),
      stopLossPrice: round2(entry * (1 + slPct / 100)),
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

  const sys = settings.system;
  const robotHandshakeAt =
    typeof sys?.robotHandshakeAt === 'string' && sys.robotHandshakeAt.trim() ? sys.robotHandshakeAt.trim() : null;
  const robotHandshakeSource =
    sys?.robotHandshakeSource === 'telegram' || sys?.robotHandshakeSource === 'dashboard'
      ? sys.robotHandshakeSource
      : null;

  return {
    mode,
    masterSwitchEnabled: Boolean(execution.masterSwitchEnabled),
    minConfidenceToExecute: execution.minConfidenceToExecute ?? 80,
    liveApiKeyConfigured: liveReady,
    liveLocked: !liveReady,
    goLiveSafetyAcknowledged: Boolean(execution.goLiveSafetyAcknowledged),
    virtualBalanceUsd,
    winRatePct: round2(summary.winRatePct),
    activeTradesCount: activeTrades.length,
    activeTrades,
    robotHandshakeAt,
    robotHandshakeSource,
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
    alphaEvolution,
  };
}

export interface AlphaSignalExecutionInput {
  id?: string;
  /** Stable key for CEO terminal retries; maps to trade_executions primary key when safe. */
  idempotencyKey?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType?: 'market' | 'limit';
  limitPrice?: number;
  amountUsd?: number;
}

function normalizeCcxtSymbol(symbol: string): string {
  const s = (symbol || '').toUpperCase().replace(/\s+/g, '');
  if (s.includes('/')) return s;
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}/USDT`;
  return s;
}

/**
 * CEO-facing execution service: records PAPER or sends LIVE order.
 */
export class LiveExecutionEngine {
  async executeSignal(signal: AlphaSignalExecutionInput): Promise<{
    success: boolean;
    mode: 'PAPER' | 'LIVE';
    reason: string;
    execution: TradeExecutionRow | null;
  }> {
    const settings = await getAppSettings();
    const isLiveTradingEnabled = settings.execution.masterSwitchEnabled && settings.execution.mode === 'LIVE';
    const mode: 'PAPER' | 'LIVE' = isLiveTradingEnabled ? 'LIVE' : 'PAPER';
    const symbol = normalizeSymbol(signal.symbol);
    const amountUsd = signal.amountUsd ?? settings.trading.defaultTradeSizeUsd ?? 100;
    const idem = signal.idempotencyKey?.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const executionId =
      idem && idem.length >= 8 ? `alpha-exec-${idem}` : `alpha-exec-${generateSafeId()}`;

    const { row: execution, inserted: executionInserted } = await insertTradeExecution({
      id: executionId,
      symbol,
      alphaSignalId: signal.id ?? null,
      type: mode,
      side: signal.side,
      amount: amountUsd,
      entryPrice: signal.limitPrice ?? 0,
      status: 'OPEN',
    });

    if (!isLiveTradingEnabled) {
      return { success: true, mode, reason: 'isLiveTradingEnabled=false; stored as PAPER execution.', execution };
    }

    if (!executionInserted) {
      return {
        success: true,
        mode,
        reason: 'Idempotent replay: execution record already exists for this key; no duplicate exchange order.',
        execution,
      };
    }

    try {
      const apiKey = process.env.BINANCE_API_KEY?.trim();
      const secret = process.env.BINANCE_SECRET?.trim();
      if (!apiKey || !secret) {
        if (execution?.id) await markTradeExecutionFailed(execution.id);
        return { success: false, mode, reason: 'Missing BINANCE_API_KEY / BINANCE_SECRET.', execution };
      }

      const exchange = new ccxt.binance({
        apiKey,
        secret,
        enableRateLimit: true,
        options: { defaultType: 'spot' },
      });

      const ccxtSymbol = normalizeCcxtSymbol(symbol);
      const ticker = await exchange.fetchTicker(ccxtSymbol);
      const marketPrice = Number(ticker.last ?? ticker.close ?? ticker.ask ?? ticker.bid ?? 0);
      if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
        throw new Error(`Invalid market price for ${ccxtSymbol}.`);
      }

      const amountBase = amountUsd / marketPrice;
      if (!Number.isFinite(amountBase) || amountBase <= 0) {
        throw new Error('Invalid order amount.');
      }

      const orderType = signal.orderType ?? 'market';
      await exchange.createOrder(
        ccxtSymbol,
        orderType,
        signal.side.toLowerCase() as 'buy' | 'sell',
        amountBase,
        orderType === 'limit' ? signal.limitPrice : undefined
      );

      return { success: true, mode, reason: `LIVE ${orderType.toUpperCase()} order submitted.`, execution };
    } catch (err) {
      console.error('[LiveExecutionEngine] executeSignal failed:', err);
      if (execution?.id) await markTradeExecutionFailed(execution.id);
      return {
        success: false,
        mode,
        reason: err instanceof Error ? err.message : 'Unknown live execution failure.',
        execution,
      };
    }
  }
}

export const liveExecutionEngine = new LiveExecutionEngine();
