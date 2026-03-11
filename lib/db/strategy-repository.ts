import fs from 'fs';
import path from 'path';
import { StrategyInsight } from '@/lib/schemas/strategy-insight';

const STRATEGY_DB_PATH = path.join(process.cwd(), 'strategy-insights.json');

async function readAllInternal(): Promise<StrategyInsight[]> {
  try {
    const raw = await fs.promises.readFile(STRATEGY_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? (parsed as StrategyInsight[]) : [];
    // Backfill status for legacy rows
    return rows.map((row) => ({
      ...row,
      status: row.status ?? 'pending',
    }));
  } catch {
    return [];
  }
}

async function saveAllInternal(rows: StrategyInsight[]): Promise<void> {
  if (process.env.NODE_ENV === 'production') return; // Vercel: no file writes
  try {
    const payload = JSON.stringify(rows, null, 2);
    const tmp = `${STRATEGY_DB_PATH}.tmp`;
    await fs.promises.writeFile(tmp, payload, 'utf-8');
    await fs.promises.rename(tmp, STRATEGY_DB_PATH);
  } catch {
    // Read-only filesystem: skip write to avoid 500
  }
}

export async function listStrategyInsights(): Promise<StrategyInsight[]> {
  return readAllInternal();
}

export async function appendStrategyInsights(newInsights: StrategyInsight[]): Promise<void> {
  if (!newInsights.length) return;
  const existing = await readAllInternal();
  const normalizedNew = newInsights.map((i) => ({
    ...i,
    status: i.status ?? 'pending',
  }));
  const merged = [...existing, ...normalizedNew];
  await saveAllInternal(merged);
}

export async function updateStrategyInsightStatus(id: string, status: StrategyInsight['status']): Promise<void> {
  const existing = await readAllInternal();
  const updated = existing.map((row) => (row.id === id ? { ...row, status } : row));
  await saveAllInternal(updated);
}

