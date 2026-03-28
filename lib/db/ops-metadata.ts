/**
 * Ops metadata (e.g. last_pinecone_upsert_at) on `system_settings` singleton (id = 1).
 * Avoids INSERT/UPSERT into `settings` when production DB uses a non-standard key-value shape.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';
import { ensureSystemSettingsTable } from '@/lib/db/system-settings';

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

const ROW_ID = 1;

/** Legacy KV key (older builds wrote here). */
const LEGACY_KV_KEY = 'last_pinecone_upsert_at';

export async function getLastPineconeUpsertAt(): Promise<string | null> {
  if (!usePostgres()) return null;
  const ok = await ensureSystemSettingsTable();
  if (!ok) return null;
  try {
    const { rows } = await sql`
      SELECT last_pinecone_upsert_at FROM system_settings WHERE id = ${ROW_ID} LIMIT 1
    `;
    const row = rows?.[0] as { last_pinecone_upsert_at?: unknown } | undefined;
    const raw = row?.last_pinecone_upsert_at;
    if (raw != null) {
      if (typeof raw === 'string') return raw;
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
    }
    try {
      const { rows: legacy } = await sql`
        SELECT value FROM settings WHERE key = ${LEGACY_KV_KEY} LIMIT 1
      `;
      const v = (legacy?.[0] as { value?: unknown } | undefined)?.value;
      if (typeof v === 'string') return v.replace(/^"|"$/g, '') || v;
    } catch {
      /* settings table missing or different schema */
    }
    return null;
  } catch {
    return null;
  }
}

export async function setLastPineconeUpsertAt(isoTimestamp: string): Promise<void> {
  if (!usePostgres()) return;
  const ok = await ensureSystemSettingsTable();
  if (!ok) return;
  try {
    await sql`
      UPDATE system_settings
      SET last_pinecone_upsert_at = ${isoTimestamp}, updated_at = NOW()
      WHERE id = ${ROW_ID}
    `;
  } catch (err) {
    console.error('[SYSTEM AUDIT] setLastPineconeUpsertAt failed:', err);
  }
}
