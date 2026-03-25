import { listClosedTradeReinforcementRows } from '@/lib/db/virtual-trades-history';
import { applyExpertWeightDeltas, getExpertWeights, type ExpertWeights } from '@/lib/trading/expert-weights';
import { dispatchCriticalAlert } from '@/lib/ops/alert-dispatcher';

type TradeDirection = 'bullish' | 'bearish' | 'neutral';
type ExpertVote = 'bullish' | 'bearish' | 'neutral' | null;

interface ParsedBreakdown {
  data: ExpertVote;
  news: ExpertVote;
  macro: ExpertVote;
}

const DEFAULT_DAYS_BACK = 7;
const STEP_DELTA = 0.03;
const EPSILON = 0.000001;

function normalizeVote(raw: unknown): ExpertVote {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (raw > 55) return 'bullish';
    if (raw < 45) return 'bearish';
    return 'neutral';
  }
  const v = String(raw).trim().toLowerCase();
  if (['bullish', 'buy', 'long', 'up'].includes(v)) return 'bullish';
  if (['bearish', 'sell', 'short', 'down'].includes(v)) return 'bearish';
  if (['neutral', 'hold', 'flat'].includes(v)) return 'neutral';
  return null;
}

function readPath(
  src: Record<string, unknown>,
  ...path: string[]
): unknown {
  let current: unknown = src;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parseBreakdown(json: string | null): ParsedBreakdown {
  if (!json) return { data: null, news: null, macro: null };
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: null, news: null, macro: null };
    }
    const obj = parsed as Record<string, unknown>;
    const dataVote = normalizeVote(
      readPath(obj, 'dataExpert', 'stance') ??
        readPath(obj, 'technician', 'stance') ??
        readPath(obj, 'technician', 'score') ??
        readPath(obj, 'expert1', 'stance') ??
        readPath(obj, 'expert1', 'confidence')
    );
    const newsVote = normalizeVote(
      readPath(obj, 'newsExpert', 'stance') ??
        readPath(obj, 'marketPsychologist', 'stance') ??
        readPath(obj, 'marketPsychologist', 'score') ??
        readPath(obj, 'expert2', 'stance') ??
        readPath(obj, 'expert2', 'confidence')
    );
    const macroVote = normalizeVote(
      readPath(obj, 'macroExpert', 'stance') ??
        readPath(obj, 'macroOrderBook', 'stance') ??
        readPath(obj, 'macroOrderBook', 'score') ??
        readPath(obj, 'expert5', 'stance') ??
        readPath(obj, 'expert5', 'confidence')
    );
    return { data: dataVote, news: newsVote, macro: macroVote };
  } catch {
    return { data: null, news: null, macro: null };
  }
}

function directionFromPnl(pnlNetUsd: number): TradeDirection {
  if (pnlNetUsd > EPSILON) return 'bullish';
  if (pnlNetUsd < -EPSILON) return 'bearish';
  return 'neutral';
}

function scoreVote(vote: ExpertVote, outcome: TradeDirection): number {
  if (vote == null || outcome === 'neutral') return 0;
  if (vote === outcome) return 1;
  if (vote === 'neutral') return -0.5;
  return -1;
}

export interface ReinforcementRunResult {
  tradesEvaluated: number;
  profitableTrades: number;
  losingTrades: number;
  previousWeights: ExpertWeights;
  updatedWeights: ExpertWeights;
  deltas: ExpertWeights;
}

export class ReinforcementEngine {
  async evaluateRecentTrades(daysBack = DEFAULT_DAYS_BACK): Promise<ReinforcementRunResult> {
    const trades = await listClosedTradeReinforcementRows(daysBack);
    const previousWeights = await getExpertWeights();
    if (trades.length === 0) {
      return {
        tradesEvaluated: 0,
        profitableTrades: 0,
        losingTrades: 0,
        previousWeights,
        updatedWeights: previousWeights,
        deltas: { dataExpertWeight: 0, newsExpertWeight: 0, macroExpertWeight: 0 },
      };
    }

    let profitableTrades = 0;
    let losingTrades = 0;
    let dataDelta = 0;
    let newsDelta = 0;
    let macroDelta = 0;

    for (const trade of trades) {
      if (trade.pnl_net_usd > EPSILON) profitableTrades++;
      else if (trade.pnl_net_usd < -EPSILON) losingTrades++;
      const outcome = directionFromPnl(trade.pnl_net_usd);
      const votes = parseBreakdown(trade.expert_breakdown_json);
      dataDelta += STEP_DELTA * scoreVote(votes.data, outcome);
      newsDelta += STEP_DELTA * scoreVote(votes.news, outcome);
      macroDelta += STEP_DELTA * scoreVote(votes.macro, outcome);
    }

    const updatedWeights = await applyExpertWeightDeltas(
      {
        dataExpertWeight: dataDelta,
        newsExpertWeight: newsDelta,
        macroExpertWeight: macroDelta,
      },
      `RL post-mortem (${trades.length} closed trades/${daysBack}d)`
    );

    await dispatchCriticalAlert(
      'Reinforcement Post-Mortem Complete',
      `Expert weights updated from ${trades.length} closed trades (${daysBack}d window). Winners=${profitableTrades}, losers=${losingTrades}.`,
      'INFO'
    );

    return {
      tradesEvaluated: trades.length,
      profitableTrades,
      losingTrades,
      previousWeights,
      updatedWeights,
      deltas: {
        dataExpertWeight: dataDelta,
        newsExpertWeight: newsDelta,
        macroExpertWeight: macroDelta,
      },
    };
  }
}

