/**
 * Quantum Mon Cheri — Data Relay Server (Server B)
 *
 * Runs on port 9000.  Bridges the main Next.js app (Server 1) to external
 * data providers (CryptoQuant, Whale Alert, Binance) to bypass geo-blocks
 * and consolidate API-key management.
 *
 * Endpoints
 * ─────────
 *   GET  /health                         → liveness check
 *   GET  /whale-data?ticker=BTC          → orchestrated whale data
 *   GET  /relay/cryptoquant/<path>       → proxy → api.cryptoquant.com/v1/<path>
 *   GET  /relay/whale-alert/<path>       → proxy → api.whale-alert.io/v1/<path>
 *
 * Auth: every request must carry  X-Relay-Secret: <ADMIN_SECRET>
 *       (skip on /health).
 */

'use strict';

require('dotenv').config();

const http   = require('http');
const https  = require('https');
const { URL } = require('url');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT          = parseInt(process.env.RELAY_PORT  || '9000', 10);
const ADMIN_SECRET  = (process.env.ADMIN_SECRET         || '').trim();
const CQ_API_KEY    = (process.env.CRYPTOQUANT_API_KEY  || '').trim();
const WA_API_KEY    = (process.env.WHALE_ALERT_API_KEY  || '').trim();
const CMC_API_KEY   = (process.env.CMC_API_KEY          || '').trim();

const WHALE_ALERT_MIN_USD = 500_000;
const LOOKBACK_SECS       = 3_600;   // 1 hour
const BINANCE_WHALE_USD   = 100_000;

// ── Tiny fetch wrapper using Node built-ins ───────────────────────────────────
function httpGet(urlStr, headers = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(urlStr);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const options  = {
      hostname : parsed.hostname,
      port     : parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path     : parsed.pathname + parsed.search,
      method   : 'GET',
      headers  : { Accept: 'application/json', ...headers },
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)); });
    req.on('error', reject);
    req.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonOk(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function jsonErr(res, message, status = 500) {
  jsonOk(res, { error: message }, status);
}

function checkAuth(req) {
  if (!ADMIN_SECRET) return true;
  const header = req.headers['x-relay-secret'] || '';
  return header === ADMIN_SECRET;
}

// ── Whale data providers ──────────────────────────────────────────────────────

/** CryptoQuant proxy — fetches netflow + whale-ratio for a ticker. */
async function fetchCryptoQuant(ticker) {
  if (!CQ_API_KEY) throw new Error('CRYPTOQUANT_API_KEY not set on relay');
  const asset = ticker.toLowerCase();
  const authHeader = { Authorization: `Bearer ${CQ_API_KEY}` };

  const [nfRes, wrRes] = await Promise.all([
    httpGet(`https://api.cryptoquant.com/v1/${asset}/exchange-flows/netflow`, authHeader),
    httpGet(`https://api.cryptoquant.com/v1/${asset}/flow-indicator/whale-ratio`, authHeader),
  ]);

  if (nfRes.status !== 200 || wrRes.status !== 200) {
    throw new Error(`CryptoQuant HTTP — netflow=${nfRes.status} whaleRatio=${wrRes.status}`);
  }

  const nfBody = JSON.parse(nfRes.body);
  const wrBody = JSON.parse(wrRes.body);

  const nfVal  = nfBody?.result?.data?.[0]?.value;
  const wrVal  = wrBody?.result?.data?.[0]?.value;

  const netFlow      = nfVal !== undefined && isFinite(+nfVal) ? +nfVal : null;
  const severeInflow = wrVal !== undefined && isFinite(+wrVal) ? (+wrVal > 85 ? 1 : 0) : null;

  return {
    assetTicker             : ticker,
    status                  : 'LIVE',
    totalMovements          : 1,
    severeInflowsToExchanges: severeInflow,
    largestMovementUsd      : netFlow,
    netExchangeFlowUsd      : netFlow,
    generatedAt             : new Date().toISOString(),
    movements               : [],
    providerNote            : '[Relay] CryptoQuant live data.',
  };
}

/** Whale Alert proxy — fetches recent large transactions for a ticker. */
async function fetchWhaleAlert(ticker) {
  if (!WA_API_KEY) throw new Error('WHALE_ALERT_API_KEY not set on relay');

  const startTs = Math.floor(Date.now() / 1000) - LOOKBACK_SECS;
  const symbol  = ticker.toLowerCase();

  const urlStr =
    `https://api.whale-alert.io/v1/transactions` +
    `?api_key=${encodeURIComponent(WA_API_KEY)}` +
    `&min_value=${WHALE_ALERT_MIN_USD}` +
    `&start=${startTs}` +
    `&currency=${symbol}` +
    `&limit=100`;

  const res = await httpGet(urlStr, {}, 12_000);
  if (res.status !== 200) throw new Error(`Whale Alert HTTP ${res.status}`);

  const body = JSON.parse(res.body);
  if (body.result !== 'success') throw new Error(`Whale Alert: ${body.message ?? 'unknown error'}`);

  const BLOCKCHAIN_TICKER = {
    bitcoin: 'BTC', ethereum: 'ETH', tron: 'TRX', ripple: 'XRP',
    cardano: 'ADA', solana: 'SOL', dogecoin: 'DOGE', litecoin: 'LTC',
    avalanche: 'AVAX', polygon: 'MATIC',
  };

  let inflowUsd = 0, outflowUsd = 0, largestUsd = 0;
  const movements = [];

  for (const tx of (body.transactions || [])) {
    const mapped = BLOCKCHAIN_TICKER[(tx.blockchain || '').toLowerCase()];
    if ((mapped ?? tx.symbol?.toUpperCase()) !== ticker) continue;

    const usd = tx.amount_usd > 0 ? tx.amount_usd : 0;
    if (usd <= 0) continue;
    if (usd > largestUsd) largestUsd = usd;

    const dir =
      tx.to?.owner_type === 'exchange'   ? 'inflow_to_exchange' :
      tx.from?.owner_type === 'exchange' ? 'outflow_from_exchange' :
                                           'wallet_to_wallet';

    if (dir === 'inflow_to_exchange')    inflowUsd  += usd;
    if (dir === 'outflow_from_exchange') outflowUsd += usd;

    movements.push({
      assetTicker      : ticker,
      transactionHash  : tx.hash,
      amount           : tx.amount,
      amountUsdEstimate: usd,
      fromLabel        : tx.from?.owner || tx.from?.address?.slice(0, 14) || 'unknown',
      fromType         : tx.from?.owner_type === 'exchange' ? 'exchange' : 'unknown',
      toLabel          : tx.to?.owner   || tx.to?.address?.slice(0, 14)   || 'unknown',
      toType           : tx.to?.owner_type   === 'exchange' ? 'exchange' : 'unknown',
      direction        : dir,
      anomalyScore     : usd >= 50e6 ? 95 : usd >= 10e6 ? 85 : usd >= 1e6 ? 65 : 35,
      timestamp        : new Date(tx.timestamp * 1000).toISOString(),
      narrative        : `Whale Alert (relay): ${(tx.amount || 0).toLocaleString()} ${ticker} ~$${(usd / 1e6).toFixed(2)}M`,
      source           : 'live',
    });
  }

  const net          = inflowUsd - outflowUsd;
  const total        = inflowUsd + outflowUsd;
  const severeInflow = total > 0 && inflowUsd / total > 0.8;

  return {
    assetTicker             : ticker,
    status                  : 'LIVE',
    totalMovements          : movements.length,
    severeInflowsToExchanges: severeInflow ? 1 : 0,
    largestMovementUsd      : largestUsd > 0 ? largestUsd : null,
    netExchangeFlowUsd      : net !== 0 ? net : null,
    generatedAt             : new Date().toISOString(),
    movements,
    providerNote            : `[Relay] Whale Alert (1h ≥$${WHALE_ALERT_MIN_USD / 1000}k): ${movements.length} txns.`,
  };
}

/** Binance public aggTrades — no API key required. */
async function fetchBinance(ticker) {
  const symbol = `${ticker.toUpperCase()}USDT`;
  const res    = await httpGet(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`);
  if (res.status !== 200) throw new Error(`Binance HTTP ${res.status}`);

  const trades = JSON.parse(res.body);
  let buyUsd = 0, sellUsd = 0, largestUsd = 0, whaleCount = 0;

  for (const t of trades) {
    const price = parseFloat(t.p), qty = parseFloat(t.q);
    if (!isFinite(price) || !isFinite(qty)) continue;
    const tradeUsd = price * qty;
    if (tradeUsd < BINANCE_WHALE_USD) continue;
    whaleCount++;
    if (tradeUsd > largestUsd) largestUsd = tradeUsd;
    if (t.m) sellUsd += tradeUsd; else buyUsd += tradeUsd;
  }

  const net        = buyUsd - sellUsd;
  const totalVol   = buyUsd + sellUsd;
  const severeIn   = totalVol > 0 && sellUsd / totalVol > 0.85;
  const movements  = whaleCount > 0 ? [{
    assetTicker      : ticker,
    transactionHash  : `binance-relay-${Date.now()}`,
    amount           : null,
    amountUsdEstimate: largestUsd,
    fromLabel        : net < 0 ? 'Large Seller' : 'Large Buyer',
    fromType         : 'unknown',
    toLabel          : 'Exchange',
    toType           : 'exchange',
    direction        : net < 0 ? 'inflow_to_exchange' : 'outflow_from_exchange',
    anomalyScore     : whaleCount > 10 ? 85 : whaleCount > 5 ? 60 : 35,
    timestamp        : new Date().toISOString(),
    narrative        : `[Relay] Binance: ${whaleCount} whale trades (≥$${BINANCE_WHALE_USD / 1000}k). Net: $${(net / 1e6).toFixed(2)}M`,
    source           : 'live',
  }] : [];

  return {
    assetTicker             : ticker,
    status                  : 'LIVE',
    totalMovements          : whaleCount,
    severeInflowsToExchanges: severeIn ? 1 : 0,
    largestMovementUsd      : largestUsd > 0 ? largestUsd : null,
    netExchangeFlowUsd      : net !== 0 ? net : null,
    generatedAt             : new Date().toISOString(),
    movements,
    providerNote            : `[Relay] Binance aggTrades: ${whaleCount} whale trades ≥$${BINANCE_WHALE_USD / 1000}k.`,
  };
}

/** Orchestrator: CryptoQuant → Whale Alert → Binance */
async function orchestrateWhaleData(ticker) {
  if (CQ_API_KEY) {
    try { return await fetchCryptoQuant(ticker); } catch (e) {
      console.warn(`[relay] CryptoQuant failed: ${e.message} — trying Whale Alert`);
    }
  }
  if (WA_API_KEY) {
    try { return await fetchWhaleAlert(ticker); } catch (e) {
      console.warn(`[relay] Whale Alert failed: ${e.message} — trying Binance`);
    }
  }
  try { return await fetchBinance(ticker); } catch (e) {
    console.error(`[relay] Binance failed: ${e.message} — all providers exhausted`);
    return {
      assetTicker: ticker, status: 'AWAITING_LIVE_DATA',
      totalMovements: null, severeInflowsToExchanges: null,
      largestMovementUsd: null, netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(), movements: [],
      providerNote: `[Relay] All providers failed. Binance: ${e.message}`,
    };
  }
}

// ── Generic reverse-proxy helper ──────────────────────────────────────────────
async function proxyTo(targetUrl, extraHeaders, clientRes) {
  try {
    const result = await httpGet(targetUrl, extraHeaders, 15_000);
    clientRes.writeHead(result.status, { 'Content-Type': 'application/json' });
    clientRes.end(result.body);
  } catch (e) {
    jsonErr(clientRes, `Upstream error: ${e.message}`);
  }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // ── /health (no auth required) ───────────────────────────────────────────
  if (pathname === '/health' || pathname === '/') {
    return jsonOk(res, { status: 'ok', service: 'quantum-relay', port: PORT, ts: new Date().toISOString() });
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
  if (!checkAuth(req)) {
    return jsonErr(res, 'Unauthorized — missing or invalid X-Relay-Secret', 401);
  }

  // ── /whale-data?ticker=BTC ───────────────────────────────────────────────
  if (pathname === '/whale-data') {
    const ticker = (urlObj.searchParams.get('ticker') || 'BTC').toUpperCase().replace(/USDT$/i, '');
    console.log(`[relay] /whale-data  ticker=${ticker}`);
    try {
      const data = await orchestrateWhaleData(ticker);
      return jsonOk(res, data);
    } catch (e) {
      return jsonErr(res, e.message);
    }
  }

  // ── /relay/cryptoquant/<rest>  (generic CQ proxy) ────────────────────────
  if (pathname.startsWith('/relay/cryptoquant')) {
    const rest      = pathname.replace(/^\/relay\/cryptoquant/, '') || '/';
    const upstream  = `https://api.cryptoquant.com/v1${rest}${urlObj.search}`;
    console.log(`[relay] CQ proxy → ${upstream}`);
    return proxyTo(upstream, { Authorization: `Bearer ${CQ_API_KEY}` }, res);
  }

  // ── /relay/whale-alert/<rest>  (generic WA proxy) ────────────────────────
  if (pathname.startsWith('/relay/whale-alert')) {
    const rest      = pathname.replace(/^\/relay\/whale-alert/, '') || '/transactions';
    const upstream  = `https://api.whale-alert.io/v1${rest}${urlObj.search}`;
    console.log(`[relay] WA proxy → ${upstream}`);
    return proxyTo(upstream, {}, res);   // WA key is in the query string from the caller
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  return jsonErr(res, `Not found: ${pathname}`, 404);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[quantum-relay] ✓  Listening on 0.0.0.0:${PORT}`);
  console.log(`[quantum-relay]    CryptoQuant key : ${CQ_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[quantum-relay]    Whale Alert key : ${WA_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[quantum-relay]    Admin secret    : ${ADMIN_SECRET ? 'SET' : 'NOT SET (open)'}`);
});

server.on('error', (err) => {
  console.error('[quantum-relay] Server error:', err.message);
  process.exit(1);
});

process.on('SIGTERM', () => { server.close(() => { console.log('[quantum-relay] Graceful shutdown.'); process.exit(0); }); });
process.on('SIGINT',  () => { server.close(() => { console.log('[quantum-relay] Graceful shutdown.'); process.exit(0); }); });
