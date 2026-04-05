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

/**
 * Returns true when Postgres is configured. Kept for backward compatibility
 * with modules that call this before querying system_settings.
 * Schema is guaranteed by db-bootstrapper.ts at server boot.
 */
export async function ensureSystemSettingsTable(): Promise<boolean> {
  return usePostgres();
}

export interface ScannerSettingsRow {
  scanner_is_active: boolean;
  last_scan_timestamp: number | null;
}

export async function getScannerSettings(): Promise<ScannerSettingsRow | null> {
  if (!usePostgres()) return null;
  try {
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
  } catch (err) {
    console.error('getScannerSettings failed:', err);
    return null;
  }
}

export async function setScannerActive(
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!usePostgres()) {
    return { ok: false, error: 'Postgres not configured' };
  }
  try {
    await sql`
      UPDATE system_settings SET scanner_is_active = ${isActive}, updated_at = NOW() WHERE id = ${ROW_ID}
    `;
    return { ok: true };
  } catch (err) {
    console.error('setScannerActive failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to update scanner settings';
    return { ok: false, error: message };
  }
}

export async function setLastScanTimestamp(ts: number): Promise<void> {
  if (!usePostgres()) return;
  try {
    await sql`
      UPDATE system_settings SET last_scan_timestamp = ${ts}, updated_at = NOW() WHERE id = ${ROW_ID}
    `;
  } catch (err) {
    console.error('setLastScanTimestamp failed:', err);
  }
}
