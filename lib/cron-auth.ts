/**
 * Strict operational auth:
 * - Authorization: Bearer <ADMIN_SECRET>
 * - x-cron-secret: <CRON_SECRET|WORKER_CRON_SECRET>
 * Header-only validation (no URL/query fallback).
 */

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function getProvidedSecret(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return normalize(authHeader.slice(7));
  }
  return null;
}

export function getCronSecret(): string {
  return normalize(process.env.CRON_SECRET ?? process.env.WORKER_CRON_SECRET ?? '');
}

export function getAdminSecret(): string {
  return normalize(process.env.ADMIN_SECRET ?? '');
}

function getCronHeaderSecret(request: Request): string | null {
  const value = request.headers.get('x-cron-secret');
  if (!value || value.trim() === '') return null;
  return normalize(value);
}

/** Returns true if request is authorized with CRON_SECRET. */
export function validateCronAuth(request: Request): boolean {
  const secret = getCronSecret();
  const token = getCronHeaderSecret(request);
  return Boolean(secret && token && token === secret);
}

/** Returns the normalized token if authorized, null otherwise. */
export function getAuthorizedToken(request: Request): string | null {
  const adminSecret = getAdminSecret();
  const bearerToken = getProvidedSecret(request);
  if (adminSecret && bearerToken && bearerToken === adminSecret) return bearerToken;

  const cronSecret = getCronSecret();
  const cronHeader = getCronHeaderSecret(request);
  if (cronSecret && cronHeader && cronHeader === cronSecret) return cronHeader;
  return null;
}

export function validateAdminOrCronAuth(request: Request): boolean {
  return getAuthorizedToken(request) !== null;
}
