/**
 * Shared cron authentication: CRON_SECRET via Bearer or query param secret=.
 * Normalizes whitespace so env and request tokens match reliably (same as scanner).
 * Edge-compatible: no Node.js built-ins (no crypto, Buffer, etc.); uses only
 * Web APIs (Request, URL) and string comparison. Safe to use from Edge or Node routes.
 */

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function getProvidedSecret(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return normalize(authHeader.slice(7));
  }
  const url = new URL(request.url);
  const querySecret = url.searchParams.get('secret');
  if (querySecret != null && querySecret !== '') return normalize(querySecret);
  return null;
}

export function getCronSecret(): string {
  return normalize(process.env.CRON_SECRET ?? '');
}

/** Returns true if request is authorized with CRON_SECRET. */
export function validateCronAuth(request: Request): boolean {
  const secret = getCronSecret();
  const token = getProvidedSecret(request);
  return Boolean(secret && token !== null && token === secret);
}

/** Returns the normalized token if authorized, null otherwise. */
export function getAuthorizedToken(request: Request): string | null {
  const secret = getCronSecret();
  const token = getProvidedSecret(request);
  if (!secret || token === null || token !== secret) return null;
  return token;
}
