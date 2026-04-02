/**
 * Deep analysis logs: persist every Deep Analysis result in Vercel Postgres for audit and learning loop.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';
import type { DeepAnalysisResult } from '@/lib/deep-analysis-service';

export interface DeepAnalysisLogRow {
  id: number;
  symbol: string;
  created_at: string;
  news_sentiment: string;
  news_narrative_he: string;
  onchain_summary_he: string;
  onchain_signal: string;
  technical_score: number;
  weighted_verdict_pct: number;
  verdict_he: string;
  recommendation_he: string;
  prediction_id: string | null;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export async function insertDeepAnalysisLog(
  result: DeepAnalysisResult,
  predictionId?: string | null
): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const { rows } = await sql`
      INSERT INTO deep_analysis_logs (symbol, created_at, news_sentiment, news_narrative_he, onchain_summary_he, onchain_signal, technical_score, weighted_verdict_pct, verdict_he, recommendation_he, prediction_id)
      VALUES (${result.symbol}, ${result.created_at}, ${result.news.sentiment}, ${result.news.narrative_he}, ${result.onchain.summary_he}, ${result.onchain.signal}, ${result.technical.score}, ${result.weighted_verdict_pct}, ${result.verdict_he}, ${result.recommendation_he}, ${predictionId ?? null})
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('insertDeepAnalysisLog failed:', err);
    return 0;
  }
}

export async function getDeepAnalysisLogsBySymbol(symbol: string, limit = 20): Promise<DeepAnalysisLogRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, symbol, created_at::text, news_sentiment, news_narrative_he, onchain_summary_he, onchain_signal, technical_score, weighted_verdict_pct, verdict_he, recommendation_he, prediction_id
      FROM deep_analysis_logs WHERE symbol = ${symbol} ORDER BY created_at DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapRow) as DeepAnalysisLogRow[];
  } catch (err) {
    console.error('getDeepAnalysisLogsBySymbol failed:', err);
    return [];
  }
}

export async function getDeepAnalysisLogsByPredictionId(predictionId: string): Promise<DeepAnalysisLogRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, symbol, created_at::text, news_sentiment, news_narrative_he, onchain_summary_he, onchain_signal, technical_score, weighted_verdict_pct, verdict_he, recommendation_he, prediction_id
      FROM deep_analysis_logs WHERE prediction_id = ${predictionId} ORDER BY created_at DESC
    `;
    return (rows || []).map(mapRow) as DeepAnalysisLogRow[];
  } catch (err) {
    console.error('getDeepAnalysisLogsByPredictionId failed:', err);
    return [];
  }
}

function mapRow(r: Record<string, unknown>): DeepAnalysisLogRow {
  return {
    id: Number(r.id),
    symbol: String(r.symbol),
    created_at: String(r.created_at),
    news_sentiment: String(r.news_sentiment),
    news_narrative_he: String(r.news_narrative_he),
    onchain_summary_he: String(r.onchain_summary_he),
    onchain_signal: String(r.onchain_signal),
    technical_score: Number(r.technical_score),
    weighted_verdict_pct: Number(r.weighted_verdict_pct),
    verdict_he: String(r.verdict_he),
    recommendation_he: String(r.recommendation_he),
    prediction_id: r.prediction_id != null ? String(r.prediction_id) : null,
  };
}
