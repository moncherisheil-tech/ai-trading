import { createHmac, timingSafeEqual } from 'node:crypto';

export type SessionRole = 'viewer' | 'operator' | 'admin';

type SessionPayload = {
  role: SessionRole;
  exp: number;
};

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function getActiveSecrets(): string[] {
  const current = process.env.APP_SESSION_SECRET || '';
  const previous = process.env.APP_SESSION_SECRET_PREVIOUS || '';
  return [current, previous].filter(Boolean);
}

export function isSessionEnabled(): boolean {
  return Boolean(process.env.APP_SESSION_SECRET);
}

export function createSessionToken(role: SessionRole, ttlSeconds = 60 * 60 * 12): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    throw new Error('APP_SESSION_SECRET is missing.');
  }

  const payload: SessionPayload = {
    role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const secrets = getActiveSecrets();
  if (secrets.length === 0) return null;

  const valid = secrets.some((secret) => {
    const expected = sign(payloadB64, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  });

  if (!valid) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload?.role || !payload?.exp) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hasRequiredRole(current: SessionRole, required: SessionRole): boolean {
  const rank: Record<SessionRole, number> = {
    viewer: 1,
    operator: 2,
    admin: 3,
  };

  return rank[current] >= rank[required];
}

/**
 * In development, bypass token checks so Settings UI and Dashboards load without login.
 * Only use for local QA; production always requires valid session.
 */
export function isDevelopmentAuthBypass(): boolean {
  return process.env.NODE_ENV === 'development';
}
