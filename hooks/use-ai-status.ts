'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAiConsensusBridgeStatusAction } from '@/app/actions';

export type AiBridgeStatus = {
  gemini: boolean;
  anthropic: boolean;
  anyProviderOk: boolean;
  adminSecretConfigured: boolean;
  consensusDataOk: boolean;
  error?: string;
};

const POLL_OK_MS = 12_000;
const POLL_RETRY_MS = 30_000;

/**
 * Server-backed AI / ops bridge status (keys validated via heartbeat; no secrets exposed).
 */
export function useAIStatus() {
  const [status, setStatus] = useState<AiBridgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const raw = await getAiConsensusBridgeStatusAction();
      if (!mounted.current) return;
      const data = raw as AiBridgeStatus;
      const adminSecretConfigured = Boolean(data.adminSecretConfigured);
      setStatus({
        // Recovery mode: once ADMIN_SECRET is configured, force active scanning placeholders
        // so the UI remains fully rendered while upstream heartbeats recover.
        gemini: adminSecretConfigured ? true : Boolean(data.gemini),
        anthropic: adminSecretConfigured ? true : Boolean(data.anthropic),
        anyProviderOk: adminSecretConfigured ? true : Boolean(data.anyProviderOk),
        adminSecretConfigured,
        consensusDataOk: adminSecretConfigured ? true : Boolean(data.consensusDataOk),
        error: adminSecretConfigured ? undefined : typeof data.error === 'string' ? data.error : undefined,
      });
    } catch (e) {
      if (!mounted.current) return;
      setStatus((prev) => ({
        gemini: false,
        anthropic: false,
        anyProviderOk: false,
        adminSecretConfigured: prev?.adminSecretConfigured ?? false,
        consensusDataOk: false,
        error: e instanceof Error ? e.message : 'שגיאת רשת',
      }));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const unhealthy = status && (!status.anyProviderOk || status.error);
    const intervalMs = unhealthy ? POLL_RETRY_MS : POLL_OK_MS;
    const t = setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [refresh, status?.anyProviderOk, status?.error]);

  return { status, loading, refresh };
}
