/**
 * System-wide settings (singleton) in Vercel Postgres.
 * Used for scanner on/off and last scan timestamp.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

const ROW_ID = 1;

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        scanner_is_active BOOLEAN NOT NULL DEFAULT true,
        last_scan_timestamp BIGINT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO system_settings (id, scanner_is_active)
      VALUES (${ROW_ID}, true)
      ON CONFLICT (id) DO NOTHING
    `;
    return true;
  } catch {
    return false;
  }
}

export interface ScannerSettingsRow {
  scanner_is_active: boolean;
  last_scan_timestamp: number | null;
}

export async function getScannerSettings(): Promise<ScannerSettingsRow | null> {
  if (!usePostgres()) return null;
  try {
    await ensureTable();
    const { rows } = await sql`
      SELECT scanner_is_active, last_scan_timestamp
      FROM system_settings
      WHERE id = ${ROW_ID}
      LIMIT 1
    `;
    const r = rows?.[0] as { scanner_is_active: boolean; last_scan_timestamp: string | number | null } | undefined;
    if (!r) return null;
    return {
      scanner_is_active: Boolean(r.scanner_is_active),
      last_scan_timestamp: r.last_scan_timestamp != null ? Number(r.last_scan_timestamp) : null,
    };
  } catch {
    return null;
  }
}

export type SetScannerResult = { ok: true } | { ok: false; error: string };

export async function setScannerActive(active: boolean): Promise<SetScannerResult> {
  if (!usePostgres()) {
    const msg = 'DATABASE_URL not configured. Set DATABASE_URL in environment.';
    console.error('[SAVE_ERROR] Scanner settings:', msg);
    return { ok: false, error: msg };
  }
  try {
    await ensureTable();
    await sql`
      UPDATE system_settings
      SET scanner_is_active = ${active}, updated_at = NOW()
      WHERE id = ${ROW_ID}
    `;
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[SAVE_ERROR] Scanner settings (setScannerActive)', e);
    return { ok: false, error: message };
  }
}

export async function setLastScanTimestamp(ts: number): Promise<SetScannerResult> {
  if (!usePostgres()) {
    const msg = 'DATABASE_URL not configured. Set DATABASE_URL in environment.';
    console.error('[SAVE_ERROR] Scanner settings (setLastScanTimestamp):', msg);
    return { ok: false, error: msg };
  }
  try {
    await ensureTable();
    await sql`
      UPDATE system_settings
      SET last_scan_timestamp = ${ts}, updated_at = NOW()
      WHERE id = ${ROW_ID}
    `;
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[SAVE_ERROR] Scanner settings (setLastScanTimestamp)', e);
    return { ok: false, error: message };
  }
}
