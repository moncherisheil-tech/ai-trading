/**
 * Floor 1000 — remove demo/fake markers and absurd prices from operational tables.
 * Count-then-delete for reporting. Requires Postgres (DATABASE_URL).
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export interface SanitizeFloor1000Result {
  ok: boolean;
  skipped?: string;
  deleted: {
    historical_predictions: { demoText: number; badPrices: number };
    virtual_trades_history: { demoText: number; badPrices: number };
    scanner_alert_log: { demoText: number; badPrices: number };
  };
  totalDeleted: number;
}

async function countHistoricalDemo(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::bigint AS c FROM historical_predictions WHERE
      prediction_id ILIKE '%test%' OR prediction_id ILIKE '%demo%' OR prediction_id ILIKE '%mock%' OR prediction_id ILIKE '%dummy%'
      OR symbol ILIKE '%test%' OR symbol ILIKE '%demo%' OR symbol ILIKE '%mock%' OR symbol ILIKE '%dummy%'
      OR outcome_label ILIKE '%test%' OR outcome_label ILIKE '%demo%' OR outcome_label ILIKE '%mock%' OR outcome_label ILIKE '%dummy%'
      OR COALESCE(market_narrative,'') ILIKE '%test%' OR COALESCE(market_narrative,'') ILIKE '%demo%' OR COALESCE(market_narrative,'') ILIKE '%mock%' OR COALESCE(market_narrative,'') ILIKE '%dummy%'
      OR COALESCE(bottom_line_he,'') ILIKE '%test%' OR COALESCE(bottom_line_he,'') ILIKE '%demo%' OR COALESCE(bottom_line_he,'') ILIKE '%mock%' OR COALESCE(bottom_line_he,'') ILIKE '%dummy%'
      OR COALESCE(risk_level_he,'') ILIKE '%test%' OR COALESCE(risk_level_he,'') ILIKE '%demo%' OR COALESCE(risk_level_he,'') ILIKE '%mock%' OR COALESCE(risk_level_he,'') ILIKE '%dummy%'
      OR COALESCE(forecast_24h_he,'') ILIKE '%test%' OR COALESCE(forecast_24h_he,'') ILIKE '%demo%' OR COALESCE(forecast_24h_he,'') ILIKE '%mock%' OR COALESCE(forecast_24h_he,'') ILIKE '%dummy%'
  `;
  return Number((rows[0] as { c: string })?.c ?? 0);
}

async function deleteHistoricalDemo(): Promise<number> {
  const r = await sql`
    DELETE FROM historical_predictions WHERE
      prediction_id ILIKE '%test%' OR prediction_id ILIKE '%demo%' OR prediction_id ILIKE '%mock%' OR prediction_id ILIKE '%dummy%'
      OR symbol ILIKE '%test%' OR symbol ILIKE '%demo%' OR symbol ILIKE '%mock%' OR symbol ILIKE '%dummy%'
      OR outcome_label ILIKE '%test%' OR outcome_label ILIKE '%demo%' OR outcome_label ILIKE '%mock%' OR outcome_label ILIKE '%dummy%'
      OR COALESCE(market_narrative,'') ILIKE '%test%' OR COALESCE(market_narrative,'') ILIKE '%demo%' OR COALESCE(market_narrative,'') ILIKE '%mock%' OR COALESCE(market_narrative,'') ILIKE '%dummy%'
      OR COALESCE(bottom_line_he,'') ILIKE '%test%' OR COALESCE(bottom_line_he,'') ILIKE '%demo%' OR COALESCE(bottom_line_he,'') ILIKE '%mock%' OR COALESCE(bottom_line_he,'') ILIKE '%dummy%'
      OR COALESCE(risk_level_he,'') ILIKE '%test%' OR COALESCE(risk_level_he,'') ILIKE '%demo%' OR COALESCE(risk_level_he,'') ILIKE '%mock%' OR COALESCE(risk_level_he,'') ILIKE '%dummy%'
      OR COALESCE(forecast_24h_he,'') ILIKE '%test%' OR COALESCE(forecast_24h_he,'') ILIKE '%demo%' OR COALESCE(forecast_24h_he,'') ILIKE '%mock%' OR COALESCE(forecast_24h_he,'') ILIKE '%dummy%'
  `;
  return r.rowCount ?? 0;
}

/**
 * Rows where entry/actual fall outside known band for symbol, or fail default sanity.
 */
async function countHistoricalBadPrices(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::bigint AS c FROM historical_predictions h WHERE
      (UPPER(TRIM(h.symbol)) = 'BTCUSDT' AND (
        h.entry_price < 5000 OR h.entry_price > 2000000 OR h.actual_price < 5000 OR h.actual_price > 2000000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'ETHUSDT' AND (
        h.entry_price < 100 OR h.entry_price > 500000 OR h.actual_price < 100 OR h.actual_price > 500000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'SOLUSDT' AND (
        h.entry_price < 1 OR h.entry_price > 50000 OR h.actual_price < 1 OR h.actual_price > 50000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'BNBUSDT' AND (
        h.entry_price < 5 OR h.entry_price > 50000 OR h.actual_price < 5 OR h.actual_price > 50000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'XRPUSDT' AND (
        h.entry_price < 0.0001 OR h.entry_price > 500 OR h.actual_price < 0.0001 OR h.actual_price > 500
      ))
      OR (UPPER(TRIM(h.symbol)) NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT') AND (
        h.entry_price <= 0 OR h.actual_price <= 0 OR h.entry_price > 1e15 OR h.actual_price > 1e15
      ))
  `;
  return Number((rows[0] as { c: string })?.c ?? 0);
}

async function deleteHistoricalBadPrices(): Promise<number> {
  const r = await sql`
    DELETE FROM historical_predictions h WHERE
      (UPPER(TRIM(h.symbol)) = 'BTCUSDT' AND (
        h.entry_price < 5000 OR h.entry_price > 2000000 OR h.actual_price < 5000 OR h.actual_price > 2000000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'ETHUSDT' AND (
        h.entry_price < 100 OR h.entry_price > 500000 OR h.actual_price < 100 OR h.actual_price > 500000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'SOLUSDT' AND (
        h.entry_price < 1 OR h.entry_price > 50000 OR h.actual_price < 1 OR h.actual_price > 50000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'BNBUSDT' AND (
        h.entry_price < 5 OR h.entry_price > 50000 OR h.actual_price < 5 OR h.actual_price > 50000
      ))
      OR (UPPER(TRIM(h.symbol)) = 'XRPUSDT' AND (
        h.entry_price < 0.0001 OR h.entry_price > 500 OR h.actual_price < 0.0001 OR h.actual_price > 500
      ))
      OR (UPPER(TRIM(h.symbol)) NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT') AND (
        h.entry_price <= 0 OR h.actual_price <= 0 OR h.entry_price > 1e15 OR h.actual_price > 1e15
      ))
  `;
  return r.rowCount ?? 0;
}

async function countVirtualDemo(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::bigint AS c FROM virtual_trades_history WHERE
      symbol ILIKE '%test%' OR symbol ILIKE '%demo%' OR symbol ILIKE '%mock%' OR symbol ILIKE '%dummy%'
      OR event_id ILIKE '%test%' OR event_id ILIKE '%demo%' OR event_id ILIKE '%mock%' OR event_id ILIKE '%dummy%'
      OR COALESCE(prediction_id,'') ILIKE '%test%' OR COALESCE(prediction_id,'') ILIKE '%demo%' OR COALESCE(prediction_id,'') ILIKE '%mock%' OR COALESCE(prediction_id,'') ILIKE '%dummy%'
      OR COALESCE(reason,'') ILIKE '%test%' OR COALESCE(reason,'') ILIKE '%demo%' OR COALESCE(reason,'') ILIKE '%mock%' OR COALESCE(reason,'') ILIKE '%dummy%'
      OR COALESCE(overseer_summary,'') ILIKE '%test%' OR COALESCE(overseer_summary,'') ILIKE '%demo%' OR COALESCE(overseer_summary,'') ILIKE '%mock%' OR COALESCE(overseer_summary,'') ILIKE '%dummy%'
      OR COALESCE(overseer_reasoning_path,'') ILIKE '%test%' OR COALESCE(overseer_reasoning_path,'') ILIKE '%demo%' OR COALESCE(overseer_reasoning_path,'') ILIKE '%mock%' OR COALESCE(overseer_reasoning_path,'') ILIKE '%dummy%'
      OR signal_side ILIKE '%test%' OR signal_side ILIKE '%demo%' OR signal_side ILIKE '%mock%' OR signal_side ILIKE '%dummy%'
      OR execution_status ILIKE '%test%' OR execution_status ILIKE '%demo%' OR execution_status ILIKE '%mock%' OR execution_status ILIKE '%dummy%'
      OR COALESCE(expert_breakdown_json::text,'') ILIKE '%test%' OR COALESCE(expert_breakdown_json::text,'') ILIKE '%demo%' OR COALESCE(expert_breakdown_json::text,'') ILIKE '%mock%' OR COALESCE(expert_breakdown_json::text,'') ILIKE '%dummy%'
  `;
  return Number((rows[0] as { c: string })?.c ?? 0);
}

async function deleteVirtualDemo(): Promise<number> {
  const r = await sql`
    DELETE FROM virtual_trades_history WHERE
      symbol ILIKE '%test%' OR symbol ILIKE '%demo%' OR symbol ILIKE '%mock%' OR symbol ILIKE '%dummy%'
      OR event_id ILIKE '%test%' OR event_id ILIKE '%demo%' OR event_id ILIKE '%mock%' OR event_id ILIKE '%dummy%'
      OR COALESCE(prediction_id,'') ILIKE '%test%' OR COALESCE(prediction_id,'') ILIKE '%demo%' OR COALESCE(prediction_id,'') ILIKE '%mock%' OR COALESCE(prediction_id,'') ILIKE '%dummy%'
      OR COALESCE(reason,'') ILIKE '%test%' OR COALESCE(reason,'') ILIKE '%demo%' OR COALESCE(reason,'') ILIKE '%mock%' OR COALESCE(reason,'') ILIKE '%dummy%'
      OR COALESCE(overseer_summary,'') ILIKE '%test%' OR COALESCE(overseer_summary,'') ILIKE '%demo%' OR COALESCE(overseer_summary,'') ILIKE '%mock%' OR COALESCE(overseer_summary,'') ILIKE '%dummy%'
      OR COALESCE(overseer_reasoning_path,'') ILIKE '%test%' OR COALESCE(overseer_reasoning_path,'') ILIKE '%demo%' OR COALESCE(overseer_reasoning_path,'') ILIKE '%mock%' OR COALESCE(overseer_reasoning_path,'') ILIKE '%dummy%'
      OR signal_side ILIKE '%test%' OR signal_side ILIKE '%demo%' OR signal_side ILIKE '%mock%' OR signal_side ILIKE '%dummy%'
      OR execution_status ILIKE '%test%' OR execution_status ILIKE '%demo%' OR execution_status ILIKE '%mock%' OR execution_status ILIKE '%dummy%'
      OR COALESCE(expert_breakdown_json::text,'') ILIKE '%test%' OR COALESCE(expert_breakdown_json::text,'') ILIKE '%demo%' OR COALESCE(expert_breakdown_json::text,'') ILIKE '%mock%' OR COALESCE(expert_breakdown_json::text,'') ILIKE '%dummy%'
  `;
  return r.rowCount ?? 0;
}

async function countVirtualBadPrices(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::bigint AS c FROM virtual_trades_history v WHERE
      v.execution_price IS NOT NULL AND (
        (UPPER(TRIM(v.symbol)) = 'BTCUSDT' AND (v.execution_price < 5000 OR v.execution_price > 2000000))
        OR (UPPER(TRIM(v.symbol)) = 'ETHUSDT' AND (v.execution_price < 100 OR v.execution_price > 500000))
        OR (UPPER(TRIM(v.symbol)) = 'SOLUSDT' AND (v.execution_price < 1 OR v.execution_price > 50000))
        OR (UPPER(TRIM(v.symbol)) = 'BNBUSDT' AND (v.execution_price < 5 OR v.execution_price > 50000))
        OR (UPPER(TRIM(v.symbol)) = 'XRPUSDT' AND (v.execution_price < 0.0001 OR v.execution_price > 500))
        OR (UPPER(TRIM(v.symbol)) NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT') AND (
          v.execution_price <= 0 OR v.execution_price > 1e15
        ))
      )
  `;
  return Number((rows[0] as { c: string })?.c ?? 0);
}

async function deleteVirtualBadPrices(): Promise<number> {
  const r = await sql`
    DELETE FROM virtual_trades_history v WHERE
      v.execution_price IS NOT NULL AND (
        (UPPER(TRIM(v.symbol)) = 'BTCUSDT' AND (v.execution_price < 5000 OR v.execution_price > 2000000))
        OR (UPPER(TRIM(v.symbol)) = 'ETHUSDT' AND (v.execution_price < 100 OR v.execution_price > 500000))
        OR (UPPER(TRIM(v.symbol)) = 'SOLUSDT' AND (v.execution_price < 1 OR v.execution_price > 50000))
        OR (UPPER(TRIM(v.symbol)) = 'BNBUSDT' AND (v.execution_price < 5 OR v.execution_price > 50000))
        OR (UPPER(TRIM(v.symbol)) = 'XRPUSDT' AND (v.execution_price < 0.0001 OR v.execution_price > 500))
        OR (UPPER(TRIM(v.symbol)) NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT') AND (
          v.execution_price <= 0 OR v.execution_price > 1e15
        ))
      )
  `;
  return r.rowCount ?? 0;
}

async function countScannerDemo(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::bigint AS c FROM scanner_alert_log WHERE
      symbol ILIKE '%test%' OR symbol ILIKE '%demo%' OR symbol ILIKE '%mock%' OR symbol ILIKE '%dummy%'
      OR prediction_id ILIKE '%test%' OR prediction_id ILIKE '%demo%' OR prediction_id ILIKE '%mock%' OR prediction_id ILIKE '%dummy%'
  `;
  return Number((rows[0] as { c: string })?.c ?? 0);
}

async function deleteScannerDemo(): Promise<number> {
  const r = await sql`
    DELETE FROM scanner_alert_log WHERE
      symbol ILIKE '%test%' OR symbol ILIKE '%demo%' OR symbol ILIKE '%mock%' OR symbol ILIKE '%dummy%'
      OR prediction_id ILIKE '%test%' OR prediction_id ILIKE '%demo%' OR prediction_id ILIKE '%mock%' OR prediction_id ILIKE '%dummy%'
  `;
  return r.rowCount ?? 0;
}

async function countScannerBadPrices(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::bigint AS c FROM scanner_alert_log s WHERE
      (UPPER(TRIM(s.symbol)) = 'BTCUSDT' AND (s.entry_price < 5000 OR s.entry_price > 2000000))
      OR (UPPER(TRIM(s.symbol)) = 'ETHUSDT' AND (s.entry_price < 100 OR s.entry_price > 500000))
      OR (UPPER(TRIM(s.symbol)) = 'SOLUSDT' AND (s.entry_price < 1 OR s.entry_price > 50000))
      OR (UPPER(TRIM(s.symbol)) = 'BNBUSDT' AND (s.entry_price < 5 OR s.entry_price > 50000))
      OR (UPPER(TRIM(s.symbol)) = 'XRPUSDT' AND (s.entry_price < 0.0001 OR s.entry_price > 500))
      OR (UPPER(TRIM(s.symbol)) NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT') AND (
        s.entry_price <= 0 OR s.entry_price > 1e15
      ))
  `;
  return Number((rows[0] as { c: string })?.c ?? 0);
}

async function deleteScannerBadPrices(): Promise<number> {
  const r = await sql`
    DELETE FROM scanner_alert_log s WHERE
      (UPPER(TRIM(s.symbol)) = 'BTCUSDT' AND (s.entry_price < 5000 OR s.entry_price > 2000000))
      OR (UPPER(TRIM(s.symbol)) = 'ETHUSDT' AND (s.entry_price < 100 OR s.entry_price > 500000))
      OR (UPPER(TRIM(s.symbol)) = 'SOLUSDT' AND (s.entry_price < 1 OR s.entry_price > 50000))
      OR (UPPER(TRIM(s.symbol)) = 'BNBUSDT' AND (s.entry_price < 5 OR s.entry_price > 50000))
      OR (UPPER(TRIM(s.symbol)) = 'XRPUSDT' AND (s.entry_price < 0.0001 OR s.entry_price > 500))
      OR (UPPER(TRIM(s.symbol)) NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT') AND (
        s.entry_price <= 0 OR s.entry_price > 1e15
      ))
  `;
  return r.rowCount ?? 0;
}

/**
 * Run sanitization: demo-text purge first, then price-band purge.
 */
export async function runSanitizeFloor1000(): Promise<SanitizeFloor1000Result> {
  if (!usePostgres()) {
    return {
      ok: false,
      skipped: 'postgres_not_configured',
      deleted: {
        historical_predictions: { demoText: 0, badPrices: 0 },
        virtual_trades_history: { demoText: 0, badPrices: 0 },
        scanner_alert_log: { demoText: 0, badPrices: 0 },
      },
      totalDeleted: 0,
    };
  }

  const histDemo = await countHistoricalDemo();
  const histDemoDel = histDemo > 0 ? await deleteHistoricalDemo() : 0;

  const virtDemo = await countVirtualDemo();
  const virtDemoDel = virtDemo > 0 ? await deleteVirtualDemo() : 0;

  const scanDemo = await countScannerDemo();
  const scanDemoDel = scanDemo > 0 ? await deleteScannerDemo() : 0;

  const histBad = await countHistoricalBadPrices();
  const histBadDel = histBad > 0 ? await deleteHistoricalBadPrices() : 0;

  const virtBad = await countVirtualBadPrices();
  const virtBadDel = virtBad > 0 ? await deleteVirtualBadPrices() : 0;

  const scanBad = await countScannerBadPrices();
  const scanBadDel = scanBad > 0 ? await deleteScannerBadPrices() : 0;

  const deleted = {
    historical_predictions: { demoText: histDemoDel, badPrices: histBadDel },
    virtual_trades_history: { demoText: virtDemoDel, badPrices: virtBadDel },
    scanner_alert_log: { demoText: scanDemoDel, badPrices: scanBadDel },
  };
  const totalDeleted =
    histDemoDel + virtDemoDel + scanDemoDel + histBadDel + virtBadDel + scanBadDel;

  return { ok: true, deleted, totalDeleted };
}
