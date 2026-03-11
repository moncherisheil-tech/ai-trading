import fs from 'fs';
import path from 'path';
import { APP_CONFIG } from '@/lib/config';
import { FilePredictionRepository } from '@/lib/db/file-repository';
import { SqlitePredictionRepository } from '@/lib/db/sqlite-repository';
import { PostgresPredictionRepository } from '@/lib/db/postgres-repository';

const dbPath = path.join(process.cwd(), 'predictions.json');

export interface SourceCitation {
  source_name: string;
  source_type: 'market_data' | 'sentiment' | 'historical' | 'derived';
  timestamp: string;
  evidence_snippet: string;
  relevance_score: number;
}

export interface PredictionRecord {
  id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  probability: number;
  target_percentage: number;
  entry_price: number;
  logic: string;
  strategic_advice?: string;
  learning_context?: string;
  sources?: SourceCitation[];
  status: 'pending' | 'evaluated';
  actual_outcome?: string;
  error_report?: string;
  model_name?: string;
  fallback_used?: boolean;
  latency_ms?: number;
  validation_repaired?: boolean;
  sentiment_score?: number;
  market_narrative?: string;
  risk_status?: 'normal' | 'extreme_fear' | 'extreme_greed';
}

function isSourceCitation(value: unknown): value is SourceCitation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SourceCitation>;
  return (
    typeof item.source_name === 'string' &&
    (item.source_type === 'market_data' || item.source_type === 'sentiment' || item.source_type === 'historical' || item.source_type === 'derived') &&
    typeof item.timestamp === 'string' &&
    typeof item.evidence_snippet === 'string' &&
    typeof item.relevance_score === 'number'
  );
}

function normalizeLegacySources(input: unknown): SourceCitation[] | undefined {
  if (!Array.isArray(input)) return undefined;

  if (input.every((item) => typeof item === 'string')) {
    return input.map((name) => ({
      source_name: name,
      source_type: 'derived',
      timestamp: new Date(0).toISOString(),
      evidence_snippet: 'Legacy source migrated from string list',
      relevance_score: 0.5,
    }));
  }

  const structured = input.filter((item) => isSourceCitation(item));
  return structured.length > 0 ? structured : undefined;
}

function isPredictionRecord(value: unknown): value is PredictionRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PredictionRecord>;
  const normalizedSources = normalizeLegacySources(item.sources);

  if (normalizedSources) {
    item.sources = normalizedSources;
  }

  return (
    typeof item.id === 'string' &&
    typeof item.symbol === 'string' &&
    typeof item.prediction_date === 'string' &&
    (item.predicted_direction === 'Bullish' || item.predicted_direction === 'Bearish' || item.predicted_direction === 'Neutral') &&
    typeof item.probability === 'number' &&
    typeof item.target_percentage === 'number' &&
    typeof item.entry_price === 'number' &&
    typeof item.logic === 'string' &&
    (item.status === 'pending' || item.status === 'evaluated') &&
    (item.sources === undefined || item.sources.every((source) => isSourceCitation(source)))
  );
}

export function getDb(): PredictionRecord[] {
  throw new Error('Use getDbAsync instead.');
}

export function saveDb(data: PredictionRecord[]) {
  throw new Error('Use saveDbAsync instead.');
}

function normalizeRows(rows: PredictionRecord[]): PredictionRecord[] {
  return rows.filter(isPredictionRecord);
}

export async function getDbAsync(): Promise<PredictionRecord[]> {
  if (APP_CONFIG.dbDriver === 'postgres' && APP_CONFIG.postgresUrl) {
    const repo = new PostgresPredictionRepository(APP_CONFIG.postgresUrl);
    const rows = await repo.getAllAsync();
    return normalizeRows(rows);
  }

  if (APP_CONFIG.dbDriver === 'sqlite') {
    const repo = new SqlitePredictionRepository(path.join(process.cwd(), APP_CONFIG.sqlitePath));
    return normalizeRows(repo.getAll());
  }

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([]));
  }
  const repo = new FilePredictionRepository();
  return normalizeRows(repo.getAll());
}

export async function saveDbAsync(data: PredictionRecord[]): Promise<void> {
  const rows = normalizeRows(data);
  if (APP_CONFIG.dbDriver === 'postgres' && APP_CONFIG.postgresUrl) {
    const repo = new PostgresPredictionRepository(APP_CONFIG.postgresUrl);
    await repo.saveAllAsync(rows);
    return;
  }

  if (APP_CONFIG.dbDriver === 'sqlite') {
    const repo = new SqlitePredictionRepository(path.join(process.cwd(), APP_CONFIG.sqlitePath));
    repo.saveAll(rows);
    return;
  }

  const repo = new FilePredictionRepository();
  repo.saveAll(rows);
}
