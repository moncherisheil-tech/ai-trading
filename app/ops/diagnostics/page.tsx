import EngineRoomPage from './diagnostics-client';

// PHASE 1 — CACHE ANNIHILATION:
// Force Next.js to never serve a stale cached render of this page.
// A previously-rendered 500 shell could have been persisted by the framework.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * X-Ray server shell: catches synchronous failures during this module's render
 * (e.g. import-time issues). Client subtree errors are handled in DiagnosticsBody.
 */
export default function OpsDiagnosticsPage() {
  try {
    return <EngineRoomPage />;
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error('🚨 X-RAY CRASH LOG 🚨 [app/ops/diagnostics/page.tsx Server]', e.name, e.message, e.stack);
    return <div>SSR CRASH: Read Terminal</div>;
  }
}
