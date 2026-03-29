import { createVerify, timingSafeEqual } from 'crypto';

const DEFAULT_MAX_SKEW_MS = 60_000;

function parseTimestampMs(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Accept both seconds and milliseconds.
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function decodeSignature(raw: string | null): Buffer | null {
  if (!raw) return null;
  try {
    return Buffer.from(raw.trim(), 'base64');
  } catch {
    return null;
  }
}

export function verifyExecutionHandshake(input: {
  bodyRaw: string;
  signatureB64: string | null;
  timestampRaw: string | null;
}): { ok: boolean; reason?: string } {
  const publicKey = (process.env.EXECUTION_RSA_PUBLIC_KEY_PEM || '').trim();
  if (!publicKey) return { ok: false, reason: 'EXECUTION_RSA_PUBLIC_KEY_PEM missing' };

  const tsMs = parseTimestampMs(input.timestampRaw);
  if (tsMs == null) return { ok: false, reason: 'Invalid or missing x-exec-timestamp header' };
  const maxSkew = Number(process.env.EXECUTION_RSA_MAX_SKEW_MS || DEFAULT_MAX_SKEW_MS);
  if (!Number.isFinite(maxSkew) || maxSkew <= 0) {
    return { ok: false, reason: 'Invalid EXECUTION_RSA_MAX_SKEW_MS configuration' };
  }
  if (Math.abs(Date.now() - tsMs) > maxSkew) return { ok: false, reason: 'Timestamp outside allowed skew window' };

  const sig = decodeSignature(input.signatureB64);
  if (!sig) return { ok: false, reason: 'Invalid or missing x-exec-signature header' };

  const payload = `${tsMs}.${input.bodyRaw}`;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(payload);
  verifier.end();

  let verified = false;
  try {
    verified = verifier.verify(publicKey, sig);
  } catch {
    return { ok: false, reason: 'RSA verification failed' };
  }

  // Constant-time branch hardening for boolean conversion path.
  const expected = Buffer.from([1]);
  const actual = Buffer.from([verified ? 1 : 0]);
  const ok = timingSafeEqual(actual, expected);
  if (!ok) return { ok: false, reason: 'Signature mismatch' };
  return { ok: true };
}
