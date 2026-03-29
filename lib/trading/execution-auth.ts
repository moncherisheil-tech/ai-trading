/**
 * Execution Auth — RSA-SHA256 Handshake for Signal Execution.
 *
 * ARCHITECTURAL SEPARATION (Air-Gapped Cryptographic Logic):
 *   VERIFIER  → verifyExecutionHandshake()  — uses EXECUTION_RSA_PUBLIC_KEY_PEM  (route.ts / public-facing)
 *   SIGNER    → signExecutionHandshake()    — uses EXECUTION_RSA_PRIVATE_KEY      (internal signal generator only)
 *
 * CANONICALIZATION: Both sides serialize via fast-json-stable-stringify before signing/verifying.
 * Key ordering is deterministic — a single byte out of order triggers a 403.
 */

import { createVerify, createSign, timingSafeEqual } from 'crypto';
import stableStringify from 'fast-json-stable-stringify';

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

/**
 * Deterministically canonicalize a JSON body using fast-json-stable-stringify.
 * Keys are sorted recursively — byte-perfect across Signer and Verifier.
 * Falls back to the raw string if parsing fails (non-JSON payloads).
 */
export function canonicalizeJsonBody(raw: string): string {
  try {
    return stableStringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

// ─── VERIFIER (Public Key — used by execute-signal/route.ts) ─────────────────

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

  // Canonicalize: parse body and re-serialize with sorted keys before building the payload.
  // This ensures the Verifier and Signer always agree on byte order regardless of serialization origin.
  const canonicalBody = canonicalizeJsonBody(input.bodyRaw);
  const payload = `${tsMs}.${canonicalBody}`;

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

// ─── SIGNER (Private Key — used by the internal signal generator ONLY) ───────

/**
 * Signs an execution payload with the RSA private key.
 * ONLY the internal signal-generation service should call this.
 * The execute-signal API route (Verifier) must NEVER access EXECUTION_RSA_PRIVATE_KEY.
 *
 * @param body     - The request body object to be signed (will be canonicalized).
 * @param timestampMs - Epoch milliseconds to embed in the payload (prevents replay attacks).
 * @returns Base64-encoded RSA-SHA256 signature string.
 */
export function signExecutionHandshake(body: unknown, timestampMs: number): string {
  const privateKey = (process.env.EXECUTION_RSA_PRIVATE_KEY || '').trim();
  if (!privateKey) throw new Error('EXECUTION_RSA_PRIVATE_KEY missing — Signer is air-gapped from Verifier');

  const canonicalBody = stableStringify(body);
  const payload = `${timestampMs}.${canonicalBody}`;

  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  signer.end();
  return signer.sign(privateKey, 'base64');
}
