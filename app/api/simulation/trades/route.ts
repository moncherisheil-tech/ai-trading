/**
 * GET: List persisted simulation trades (for hydration).
 * POST: Add one simulation trade (persist to DB). Requires auth when session is enabled.
 * Server applies market-order slippage (buy higher, sell lower) and recalculates amountAsset/fee.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  listSimulationTrades,
  insertSimulationTrade,
  type SimulationTradeRow,
} from '@/lib/db/simulation-trades';
import { recordAuditLog } from '@/lib/db/audit-logs';
import { APP_CONFIG } from '@/lib/config';
import { toDecimal, round4, roundToSymbolDecimals, applySlippage, D } from '@/lib/decimal';
import { isSessionEnabled, verifySessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

/** Single source of truth: same as simulation summary and PnL (lib/decimal). */
const INITIAL_WALLET = D.startingBalance;
const SIMULATION_FEE_PCT = 0.1;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function rowToClient(row: SimulationTradeRow) {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    price: row.price,
    amountUsd: row.amount_usd,
    amountAsset: row.amount_asset,
    feeUsd: row.fee_usd,
    timestamp: row.timestamp,
    dateLabel: row.date_label,
  };
}

export async function GET(): Promise<NextResponse> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json({ trades: [] });
  }
  try {
    const rows = await listSimulationTrades();
    return NextResponse.json({
      trades: rows.map(rowToClient),
    });
  } catch {
    return NextResponse.json({ trades: [] });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', message: 'נדרשת התחברות לביצוע עסקת סימולציה.' },
        { status: 401 }
      );
    }
  }
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json(
      { success: false, error: 'DATABASE_URL (Quantum Core DB) required for persistence.' },
      { status: 400 }
    );
  }
  let body: {
    id?: string;
    symbol?: string;
    side?: string;
    price?: number;
    amountUsd?: number;
    amountAsset?: number;
    feeUsd?: number;
    timestamp?: number;
    dateLabel?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id.trim().slice(0, 128) : '';
  const rawSymbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const symbol = rawSymbol.slice(0, 20);
  const side = body.side === 'buy' || body.side === 'sell' ? body.side : null;
  const price = typeof body.price === 'number' ? body.price : Number(body.price);
  const amountUsd = typeof body.amountUsd === 'number' ? body.amountUsd : Number(body.amountUsd);
  const amountAsset = typeof body.amountAsset === 'number' ? body.amountAsset : Number(body.amountAsset);
  const feeUsd = typeof body.feeUsd === 'number' ? body.feeUsd : Number(body.feeUsd);
  const timestamp = typeof body.timestamp === 'number' ? body.timestamp : Number(body.timestamp);
  const dateLabel = typeof body.dateLabel === 'string' ? body.dateLabel : String(body.dateLabel ?? '');

  if (
    !id ||
    !symbol ||
    !side ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    !Number.isFinite(amountAsset) ||
    !Number.isFinite(feeUsd) ||
    !Number.isFinite(timestamp)
  ) {
    return NextResponse.json(
      { success: false, error: 'Missing or invalid fields: id, symbol, side, price, amountUsd, amountAsset, feeUsd, timestamp.' },
      { status: 400 }
    );
  }

  const normalizedSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;

  const slippageBps = APP_CONFIG.paperSlippageBps ?? 5;
  const executionPrice = applySlippage(price, side, slippageBps);
  const amountAssetServer = roundToSymbolDecimals(
    toDecimal(amountUsd).div(executionPrice),
    normalizedSymbol,
    'amount'
  );
  const feeUsdServer = round4(toDecimal(amountUsd).times(SIMULATION_FEE_PCT).div(100));

  try {
    const existing = await listSimulationTrades();
    const sorted = [...existing].sort((a, b) => a.timestamp - b.timestamp);
    let walletUsd = toDecimal(INITIAL_WALLET);
    const positionBySymbol = new Map<string, number>();
    for (const t of sorted) {
      if (t.side === 'buy') {
        walletUsd = walletUsd.minus(toDecimal(t.amount_usd).plus(t.fee_usd));
        positionBySymbol.set(t.symbol, (positionBySymbol.get(t.symbol) ?? 0) + t.amount_asset);
      } else {
        walletUsd = walletUsd.plus(toDecimal(t.amount_usd).minus(t.fee_usd));
        positionBySymbol.set(t.symbol, (positionBySymbol.get(t.symbol) ?? 0) - t.amount_asset);
      }
    }

    if (side === 'buy') {
      const totalCost = toDecimal(amountUsd).plus(feeUsdServer);
      if (walletUsd.lt(totalCost)) {
        return NextResponse.json(
          { success: false, error: 'INSUFFICIENT_FUNDS', message: 'יתרה פנויה לא מספקת.' },
          { status: 400 }
        );
      }
    } else {
      const position = positionBySymbol.get(normalizedSymbol) ?? 0;
      const availableAsset = position > 0 ? position : 0;
      if (toDecimal(amountAssetServer).gt(availableAsset)) {
        return NextResponse.json(
          { success: false, error: 'INSUFFICIENT_ASSET', message: 'אין מספיק נכס במצב לסגירת העסקה.' },
          { status: 400 }
        );
      }
    }

    const row: SimulationTradeRow = {
      id,
      symbol: normalizedSymbol,
      side,
      price: executionPrice,
      amount_usd: amountUsd,
      amount_asset: amountAssetServer,
      fee_usd: feeUsdServer,
      timestamp,
      date_label: dateLabel,
    };
    await insertSimulationTrade(row);
    await recordAuditLog({
      action_type: 'manual_trade',
      actor_ip: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
      payload_diff: { symbol: normalizedSymbol, side, price: executionPrice, amountUsd, amountAsset: amountAssetServer },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to persist trade.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
