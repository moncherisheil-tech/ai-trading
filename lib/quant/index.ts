/**
 * Mon Chéri Quant — shared brain: Technical Context, Open Interest, Deep Memory lessons.
 * Used by backtest-engine, consensus-engine, and analysis-core (live scanner).
 */

export {
  computeEmaSeries,
  computeBollingerSeries,
  inferMarketStructure,
  buildTechnicalContext,
  type MarketStructure,
  type TechnicalContextResult,
} from './technical-context';

export {
  fetchOpenInterest,
  getOIEnrichmentForCandle,
  formatOISignal,
  type OpenInterestRow,
  type RawKlineRow,
  type OIStatus,
  type OIEnrichment,
} from './open-interest';

export { DEEP_MEMORY_LESSON_001, getDeepMemoryLessonBlock } from './deep-memory-lessons';
