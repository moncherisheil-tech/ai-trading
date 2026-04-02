/**
 * Enterprise Audit Trail — security forensics.
 * audit_logs: timestamp, action_type, actor_ip, user_agent, payload_diff (JSON).
 * Wrap manual trade and settings functions with recordAuditLog.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface AuditLogRow {
  id: number;
  timestamp: string;
  action_type: string;
  actor_ip: string | null;
  user_agent: string | null;
  payload_diff: Record<string, unknown> | null;
  created_at: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export interface RecordAuditLogInput {
  action_type: string;
  actor_ip?: string | null;
  user_agent?: string | null;
  payload_diff?: Record<string, unknown> | null;
}

/**
 * Record an audit log entry for security forensics. Call from API routes for manual trades and settings changes.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const { rows } = await sql`
      INSERT INTO audit_logs (action_type, actor_ip, user_agent, payload_diff)
      VALUES (${input.action_type}, ${input.actor_ip ?? null}, ${input.user_agent ?? null}, ${input.payload_diff ? JSON.stringify(input.payload_diff) : null})
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('recordAuditLog failed:', err);
    return 0;
  }
}

export interface ListAuditLogsOptions {
  from_date?: string;
  to_date?: string;
  action_type?: string;
  limit?: number;
  offset?: number;
}

/**
 * List audit logs for Admin System Audit view. Searchable by date range and action_type.
 */
export async function listAuditLogs(options: ListAuditLogsOptions = {}): Promise<AuditLogRow[]> {
  if (!usePostgres()) return [];
  try {
    const limit = Math.min(500, options.limit ?? 100);
    const offset = options.offset ?? 0;

    const fromDate = options.from_date ?? '1970-01-01';
    const toDate = options.to_date ?? '2100-01-01';
    const actionType = options.action_type ?? '';

    const { rows } = actionType
      ? await sql`
          SELECT id, timestamp::text, action_type, actor_ip, user_agent, payload_diff, created_at::text
          FROM audit_logs
          WHERE timestamp >= ${fromDate}::timestamptz AND timestamp <= ${toDate}::timestamptz AND action_type = ${actionType}
          ORDER BY timestamp DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `
      : await sql`
          SELECT id, timestamp::text, action_type, actor_ip, user_agent, payload_diff, created_at::text
          FROM audit_logs
          WHERE timestamp >= ${fromDate}::timestamptz AND timestamp <= ${toDate}::timestamptz
          ORDER BY timestamp DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      action_type: String(r.action_type),
      actor_ip: r.actor_ip != null ? String(r.actor_ip) : null,
      user_agent: r.user_agent != null ? String(r.user_agent) : null,
      payload_diff: typeof r.payload_diff === 'object' && r.payload_diff != null ? (r.payload_diff as Record<string, unknown>) : null,
      created_at: String(r.created_at),
    })) as AuditLogRow[];
  } catch (err) {
    console.error('listAuditLogs failed:', err);
    return [];
  }
}
