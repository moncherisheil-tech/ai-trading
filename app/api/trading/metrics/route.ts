import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DailyMetricsRow = {
  date: string;
  total_trades: number;
  profitable_trades: number;
  prediction_matches: number;
  resolved_accuracy_trades: number;
  win_rate_pct: number;
  prediction_accuracy_pct: number;
};

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toPct(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
}

function parseDaysParam(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 90;
  return Math.max(7, Math.min(365, Math.trunc(parsed)));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json({
      success: true,
      data: [] as DailyMetricsRow[],
      days: 0,
      message: 'Postgres is not configured.',
    });
  }

  try {
    const days = parseDaysParam(new URL(request.url).searchParams.get('days'));
    const intervalValue = `${days} days`;

    const { rows } = await sql`
      WITH source AS (
        SELECT
          DATE(h.created_at) AS day,
          h.signal_side,
          vp.entry_price::float AS entry_price,
          vp.exit_price::float AS exit_price,
          vp.pnl_pct::float AS pnl_pct
        FROM virtual_trades_history h
        LEFT JOIN virtual_portfolio vp
          ON vp.id = h.virtual_trade_id
        WHERE h.created_at >= NOW() - ${intervalValue}::interval
          AND h.execution_status = 'executed'
      ),
      daily AS (
        SELECT
          day,
          COUNT(*)::int AS total_trades,
          COUNT(*) FILTER (WHERE pnl_pct > 0)::int AS profitable_trades,
          COUNT(*) FILTER (
            WHERE entry_price IS NOT NULL
              AND exit_price IS NOT NULL
          )::int AS resolved_accuracy_trades,
          COUNT(*) FILTER (
            WHERE entry_price IS NOT NULL
              AND exit_price IS NOT NULL
              AND (
                (signal_side = 'BUY' AND exit_price > entry_price)
                OR (signal_side = 'SELL' AND exit_price < entry_price)
              )
          )::int AS prediction_matches
        FROM source
        GROUP BY day
      )
      SELECT
        day::text AS date,
        total_trades,
        profitable_trades,
        prediction_matches,
        resolved_accuracy_trades,
        CASE
          WHEN total_trades > 0 THEN (profitable_trades::numeric * 100.0 / total_trades::numeric)
          ELSE 0
        END AS win_rate_pct,
        CASE
          WHEN resolved_accuracy_trades > 0 THEN (prediction_matches::numeric * 100.0 / resolved_accuracy_trades::numeric)
          ELSE 0
        END AS prediction_accuracy_pct
      FROM daily
      ORDER BY day ASC
    `;

    const data: DailyMetricsRow[] = (rows ?? []).map((row: Record<string, unknown>) => ({
      date: String(row.date),
      total_trades: toInt(row.total_trades),
      profitable_trades: toInt(row.profitable_trades),
      prediction_matches: toInt(row.prediction_matches),
      resolved_accuracy_trades: toInt(row.resolved_accuracy_trades),
      win_rate_pct: toPct(row.win_rate_pct),
      prediction_accuracy_pct: toPct(row.prediction_accuracy_pct),
    }));

    return NextResponse.json({
      success: true,
      days,
      data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to aggregate trading metrics.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
