import fs from 'fs';
import path from 'path';

const auditDir = path.join(process.cwd(), 'logs');
const auditPath = path.join(auditDir, 'audit.log');

export type AuditEvent = {
  event: string;
  level?: 'info' | 'warn' | 'error';
  meta?: Record<string, unknown>;
};

export function writeAudit(event: AuditEvent): void {
  const enabled = process.env.AUDIT_LOG_ENABLED !== 'false';
  if (!enabled) return;

  const line = JSON.stringify({
    at: new Date().toISOString(),
    level: event.level || 'info',
    event: event.event,
    meta: event.meta || {},
  });

  if (process.env.NODE_ENV === 'production') {
    // Vercel/read-only: no file I/O — use console so logs appear in Vercel dashboard
    if (event.level === 'error') {
      console.error('[audit]', line);
    } else if (event.level === 'warn') {
      console.warn('[audit]', line);
    } else {
      console.log('[audit]', line);
    }
    return;
  }

  try {
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    fs.appendFileSync(auditPath, `${line}\n`, 'utf-8');
  } catch {
    console.log('[audit]', line);
  }
}
