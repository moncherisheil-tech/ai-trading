import WebSocket from "ws";
import type { LiveUsdIlsQuote } from "@/lib/market/forex/types";
const SYMBOL = "USD/ILS";
const STALE_MS = 15000;
const HEARTBEAT_MS = 10000;
const RECONNECT_MIN_MS = 4000;
type Hub = { last: LiveUsdIlsQuote | null; ws: WebSocket | null; connecting: boolean; heartbeat: ReturnType<typeof setInterval> | null; reconnectTimer: ReturnType<typeof setTimeout> | null; };
function hub(): Hub {
  const g = globalThis as typeof globalThis & { __forexTwelveDataHub?: Hub };
  if (!g.__forexTwelveDataHub) g.__forexTwelveDataHub = { last: null, ws: null, connecting: false, heartbeat: null, reconnectTimer: null };
  return g.__forexTwelveDataHub;
}
function getApiKey(): string | undefined { const k = process.env.TWELVEDATA_API_KEY?.trim(); return k || undefined; }
function wsUrl(): string | null {
  const key = getApiKey();
  if (!key) return null;
  const base = (process.env.TWELVEDATA_WS_URL || "wss://ws.twelvedata.com/v1/quotes/price").replace(/\/$/, "");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}apikey=${encodeURIComponent(key)}`;
}
function parsePriceMessage(raw: string): number | null {
  try {
    const j = JSON.parse(raw) as { event?: string; price?: number | string };
    if (j.event && j.event !== "price") return null;
    const p = typeof j.price === "number" ? j.price : Number.parseFloat(String(j.price ?? ""));
    if (!Number.isFinite(p) || p <= 0 || p < 2 || p > 8) return null;
    return Math.round(p * 10000) / 10000;
  } catch { return null; }
}
function clearHeartbeat(h: Hub): void { if (h.heartbeat) { clearInterval(h.heartbeat); h.heartbeat = null; } }
function scheduleReconnect(): void {
  const h = hub();
  if (h.reconnectTimer) return;
  h.reconnectTimer = setTimeout(() => { h.reconnectTimer = null; ensureTwelveDataConnection(); }, RECONNECT_MIN_MS);
}
export function ensureTwelveDataConnection(): void {
  const url = wsUrl();
  const h = hub();
  if (!url) return;
  if (h.ws && (h.ws.readyState === WebSocket.OPEN || h.ws.readyState === WebSocket.CONNECTING)) return;
  if (h.connecting) return;
  h.connecting = true;
  try {
    const ws = new WebSocket(url);
    h.ws = ws;
    ws.on("open", () => {
      h.connecting = false;
      ws.send(JSON.stringify({ action: "subscribe", params: { symbols: SYMBOL } }));
      clearHeartbeat(h);
      h.heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) try { ws.send(JSON.stringify({ action: "heartbeat" })); } catch {} }, HEARTBEAT_MS);
    });
    ws.on("message", (data: WebSocket.RawData) => {
      const text = typeof data === "string" ? data : data.toString();
      const price = parsePriceMessage(text);
      if (price == null) return;
      h.last = { pair: "USD/ILS", price, receivedAtMs: Date.now(), providerId: "twelvedata" };
    });
    const teardown = () => { clearHeartbeat(h); if (h.ws === ws) h.ws = null; scheduleReconnect(); };
    ws.on("close", () => { h.connecting = false; teardown(); });
    ws.on("error", () => { h.connecting = false; try { ws.close(); } catch {} teardown(); });
  } catch { h.connecting = false; scheduleReconnect(); }
}
export function getTwelveDataUsdIlsSnapshot(): LiveUsdIlsQuote | null {
  const h = hub();
  if (!h.last || Date.now() - h.last.receivedAtMs > STALE_MS) return null;
  return h.last;
}
