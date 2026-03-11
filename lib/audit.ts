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

  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }

  const line = JSON.stringify({
    at: new Date().toISOString(),
    level: event.level || 'info',
    event: event.event,
    meta: event.meta || {},
  });

  fs.appendFileSync(auditPath, `${line}\n`, 'utf-8');
}
