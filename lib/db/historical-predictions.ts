/**
 * Historical predictions (feedback loop) persisted in Vercel Postgres for learning and accuracy metrics.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface HistoricalPredictionRow {
  id: number;
  prediction_id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  entry_price: number;
  actual_price: number;
  price_diff_pct: number;
  absolute_error_pct: number;
  target_percentage: number | null;
  probability: number | null;
  outcome_label: string;
  requires_deep_analysis: boolean;
  evaluated_at: string;
  sentiment_score: number | null;
  market_narrative: string | null;
  bottom_line_he: string | null;
  risk_level_he: string | null;
  forecast_24h_he: string | null;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export interface AppendHistoricalInput {
  prediction_id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  entry_price: number;
  actual_price: number;
  price_diff_pct: number;
  absolute_error_pct: number;
  target_percentage?: number | null;
  probability?: number | null;
  outcome_label: string;
  requires_deep_analysis: boolean;
  evaluated_at: string;
  sentiment_score?: number | null;
  market_narrative?: string | null;
  bottom_line_he?: string | null;
  risk_level_he?: string | null;
  forecast_24h_he?: string | null;
}

export async function appendHistoricalPrediction(row: AppendHistoricalInput): Promise<void> {
  if (!usePostgres()) return;
  try {
    await sql`
      INSERT INTO historical_predictions (prediction_id, symbol, prediction_date, predicted_direction, entry_price, actual_price, price_diff_pct, absolute_error_pct, target_percentage, probability, outcome_label, requires_deep_analysis, evaluated_at, sentiment_score, market_narrative, bottom_line_he, risk_level_he, forecast_24h_he)
      VALUES (${row.prediction_id}, ${row.symbol}, ${row.prediction_date}, ${row.predicted_direction}, ${row.entry_price}, ${row.actual_price}, ${row.price_diff_pct}, ${row.absolute_error_pct}, ${row.target_percentage ?? null}, ${row.probability ?? null}, ${row.outcome_label}, ${row.requires_deep_analysis}, ${row.evaluated_at}, ${row.sentiment_score ?? null}, ${row.market_narrative ?? null}, ${row.bottom_line_he ?? null}, ${row.risk_level_he ?? null}, ${row.forecast_24h_he ?? null})
    `;
  } catch (err) {
    console.error('appendHistoricalPrediction failed:', err);
  }
}

const HIT_LABELS = ['bullish_win', 'bearish_win', 'neutral_win'];

export async function getAccuracyByConfidenceBucket(limit = 100): Promise<
  Array<{ bucket: string; confidence_min: number; confidence_max: number; total: number; hits: number; success_rate_pct: number }>
> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT probability::float, outcome_label FROM historical_predictions WHERE probability IS NOT NULL ORDER BY evaluated_at DESC LIMIT ${limit}
    `;
    const raw = (rows || []) as Array<{ probability: number; outcome_label: string }>;
    const buckets = [
      { min: 50, max: 60, label: '50–60%' },
      { min: 60, max: 70, label: '60–70%' },
      { min: 70, max: 80, label: '70–80%' },
      { min: 80, max: 90, label: '80–90%' },
      { min: 90, max: 101, label: '90–100%' },
    ];
    return buckets.map((b) => {
      const inBucket = raw.filter((r) => r.probability >= b.min && r.probability < b.max);
      const hits = inBucket.filter((r) => HIT_LABELS.includes(r.outcome_label)).length;
      return {
        bucket: b.label,
        confidence_min: b.min,
        confidence_max: b.max,
        total: inBucket.length,
        hits,
        success_rate_pct: inBucket.length > 0 ? Math.round((hits / inBucket.length) * 1000) / 10 : 0,
      };
    });
  } catch (err) {
    console.error('getAccuracyByConfidenceBucket failed:', err);
    return [];
  }
}

export async function listHistoricalPredictions(limit = 100): Promise<HistoricalPredictionRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, prediction_id, symbol, prediction_date, predicted_direction, entry_price::float, actual_price::float, price_diff_pct::float, absolute_error_pct::float, target_percentage::float, probability::float, outcome_label, requires_deep_analysis, evaluated_at::text, sentiment_score::float, market_narrative, bottom_line_he, risk_level_he, forecast_24h_he
      FROM historical_predictions ORDER BY evaluated_at DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapRow) as HistoricalPredictionRow[];
  } catch (err) {
    console.error('listHistoricalPredictions failed:', err);
    return [];
  }
}

export async function getHistoricalBySymbol(symbol: string, limit = 50): Promise<HistoricalPredictionRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, prediction_id, symbol, prediction_date, predicted_direction, entry_price::float, actual_price::float, price_diff_pct::float, absolute_error_pct::float, target_percentage::float, probability::float, outcome_label, requires_deep_analysis, evaluated_at::text, sentiment_score::float, market_narrative, bottom_line_he, risk_level_he, forecast_24h_he
      FROM historical_predictions WHERE symbol = ${symbol} ORDER BY evaluated_at DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapRow) as HistoricalPredictionRow[];
  } catch (err) {
    console.error('getHistoricalBySymbol failed:', err);
    return [];
  }
}

export async function getLatestPredictionIdBySymbol(symbol: string): Promise<string | null> {
  if (!usePostgres()) return null;
  try {
    const { rows } = await sql`
      SELECT prediction_id FROM historical_predictions WHERE symbol = ${symbol} ORDER BY evaluated_at DESC LIMIT 1
    `;
    const r = rows?.[0] as { prediction_id?: string } | undefined;
    return r?.prediction_id ?? null;
  } catch (err) {
    console.error('getLatestPredictionIdBySymbol failed:', err);
    return null;
  }
}

function mapRow(r: Record<string, unknown>): HistoricalPredictionRow {
  return {
    id: Number(r.id),
    prediction_id: String(r.prediction_id),
    symbol: String(r.symbol),
    prediction_date: String(r.prediction_date),
    predicted_direction: r.predicted_direction as HistoricalPredictionRow['predicted_direction'],
    entry_price: Number(r.entry_price),
    actual_price: Number(r.actual_price),
    price_diff_pct: Number(r.price_diff_pct),
    absolute_error_pct: Number(r.absolute_error_pct),
    target_percentage: r.target_percentage != null ? Number(r.target_percentage) : null,
    probability: r.probability != null ? Number(r.probability) : null,
    outcome_label: String(r.outcome_label),
    requires_deep_analysis: Boolean(r.requires_deep_analysis),
    evaluated_at: String(r.evaluated_at),
    sentiment_score: r.sentiment_score != null ? Number(r.sentiment_score) : null,
    market_narrative: r.market_narrative != null ? String(r.market_narrative) : null,
    bottom_line_he: r.bottom_line_he != null ? String(r.bottom_line_he) : null,
    risk_level_he: r.risk_level_he != null ? String(r.risk_level_he) : null,
    forecast_24h_he: r.forecast_24h_he != null ? String(r.forecast_24h_he) : null,
  };
}
