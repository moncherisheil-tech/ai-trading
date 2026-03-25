/**
 * Ops metadata (e.g. last_pinecone_upsert_at) stored in settings table.
 * Used by diagnostics dashboard and vector-db to track last successful Pinecone upsert.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

const PINECONE_UPSERT_KEY = 'last_pinecone_upsert_at';

export async function getLastPineconeUpsertAt(): Promise<string | null> {
  if (!usePostgres()) return null;
  try {
    const { rows } = await sql`
      SELECT value FROM settings WHERE key = ${PINECONE_UPSERT_KEY} LIMIT 1
    `;
    const row = rows?.[0] as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setLastPineconeUpsertAt(isoTimestamp: string): Promise<void> {
  if (!usePostgres()) return;
  try {
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES (${PINECONE_UPSERT_KEY}, ${isoTimestamp}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${isoTimestamp}, updated_at = NOW()
    `;
  } catch (err) {
    console.error('[ops-metadata] setLastPineconeUpsertAt failed:', err);
  }
}
