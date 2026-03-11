import fs from 'fs';
import path from 'path';
import type { PredictionRecord } from '@/lib/db';
import type { PredictionRepository } from '@/lib/db/repository';

export class FilePredictionRepository implements PredictionRepository {
  private readonly dbPath = path.join(process.cwd(), 'predictions.json');

  getAll(): PredictionRecord[] {
    if (!fs.existsSync(this.dbPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as PredictionRecord[]) : [];
    } catch {
      return [];
    }
  }

  saveAll(rows: PredictionRecord[]): void {
    if (process.env.NODE_ENV === 'production') return; // Vercel: no file writes
    try {
      const tmp = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
      fs.renameSync(tmp, this.dbPath);
    } catch {
      // Read-only filesystem: skip write to avoid 500
    }
  }
}
