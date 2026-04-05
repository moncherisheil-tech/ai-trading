'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAiConsensusBridgeStatusAction } from '@/app/actions';

export type AiBridgeStatus = {
  gemini: boolean;
  anthropic: boolean;
  grok: boolean;
  /** i9 hardware feed via Redis quant:alerts — sovereign pipeline, always active. */
  internalPipelineActive: boolean;
  dbConnected: boolean;
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
        gemini: Boolean(data.gemini),
        anthropic: Boolean(data.anthropic),
        grok: Boolean(data.grok),
        internalPipelineActive: Boolean(data.internalPipelineActive ?? true),
        dbConnected: Boolean(data.dbConnected),
        anyProviderOk: Boolean(data.anyProviderOk),
        adminSecretConfigured,
        consensusDataOk: Boolean(data.consensusDataOk),
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    } catch (e) {
      if (!mounted.current) return;
      setStatus((prev) => ({
        gemini: false,
        anthropic: false,
        grok: false,
        internalPipelineActive: true,
        dbConnected: false,
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
