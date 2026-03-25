import Decimal from 'decimal.js';
import { runConsensusEngine } from '@/lib/consensus-engine';
import { getDbAsync, saveDbAsync } from '@/lib/db';
import { querySimilarTrades } from '@/lib/vector-db';
import { listClosedVirtualTradesInRange } from '@/lib/db/virtual-portfolio';
import { toDecimal, round2, D } from '@/lib/decimal';
import { sendTelegramMessage, escapeHtml, getDashboardReportKeyboard } from '@/lib/telegram';
import { getDailyCioSummary } from '@/lib/system-overseer';
import { getBaseUrl } from '@/lib/config';

type AuditStageResult = {
  passed: boolean;
  error?: string;
};

type AuditSummary = {
  allPassed: boolean;
  analysis: AuditStageResult;
  db: AuditStageResult;
  vectorStorage: AuditStageResult;
};

const MOCK_SYMBOL = 'BTCUSDT';

const MOCK_CONSENSUS_INPUT = {
  symbol: MOCK_SYMBOL,
  current_price: 43000,
  rsi_14: 52,
  atr_value: 1200,
  atr_pct_of_price: 2.79,
  macd_signal: 0.5,
  volume_profile_summary: 'Mock audit — no real profile.',
  hvn_levels: [42000, 43500, 45000],
  nearest_sr_distance_pct: 2.3,
  volatility_pct: 3.5,
};

const REFERENCE_CAPITAL = D.startingBalance.toNumber();

async function runAuditCheck(): Promise<AuditSummary> {
  const summary: AuditSummary = {
    allPassed: false,
    analysis: { passed: false },
    db: { passed: false },
    vectorStorage: { passed: false },
  };

  // Stage 1: Consensus Engine (Gemini/Groq) health
  try {
    const result = await runConsensusEngine(MOCK_CONSENSUS_INPUT, {
      timeoutMs: 60_000,
      moeConfidenceThreshold: 75,
    });
    const expertsOk =
      result.tech_score != null &&
      Number.isFinite(result.tech_score) &&
      result.risk_score != null &&
      Number.isFinite(result.risk_score) &&
      result.psych_score != null &&
      Number.isFinite(result.psych_score);
    summary.analysis.passed =
      expertsOk &&
      typeof result.master_insight_he === 'string' &&
      result.master_insight_he.length > 0;
  } catch (err) {
    summary.analysis = {
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Stage 2: DB round-trip
  try {
    const rows = await getDbAsync();
    await saveDbAsync(rows);
    summary.db.passed = true;
  } catch (err) {
    summary.db = {
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Stage 3: Vector storage (Pinecone)
  try {
    await querySimilarTrades(MOCK_SYMBOL, 2);
    summary.vectorStorage.passed = true;
  } catch (err) {
    summary.vectorStorage = {
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  summary.allPassed = summary.analysis.passed && summary.db.passed && summary.vectorStorage.passed;
  return summary;
}

async function getLast24hNetPnlUsd(): Promise<{
  totalNetPnlUsd: Decimal;
  tradesCount: number;
}> {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const closed = await listClosedVirtualTradesInRange(from.toISOString(), now.toISOString());
  if (!closed.length) {
    return { totalNetPnlUsd: new Decimal(0), tradesCount: 0 };
  }

  const total = closed.reduce((sum, t) => {
    if (t.pnl_net_usd != null && Number.isFinite(t.pnl_net_usd)) {
      return sum.plus(toDecimal(t.pnl_net_usd));
    }
    if (t.pnl_pct == null) return sum;
    return sum.plus(toDecimal(t.amount_usd).times(t.pnl_pct).div(100));
  }, new Decimal(0));

  return { totalNetPnlUsd: total, tradesCount: closed.length };
}

function formatNetPnlLine(totalNetPnlUsd: Decimal): string {
  const pnlRounded = round2(toDecimal(totalNetPnlUsd.toNumber()));
  const signPrefix = pnlRounded >= 0 ? '+' : '';
  const absStr = Math.abs(pnlRounded).toFixed(2);
  const display = `${signPrefix}$${absStr}`;
  return `💰 <b>Net PnL (24h):</b> ${display} <i>(after fees)</i>`;
}

function formatHealthLine(audit: AuditSummary): string {
  if (audit.allPassed) {
    return '🛡️ <b>System Health:</b> All Green (Gemini, Postgres, Pinecone OK)';
  }
  const parts: string[] = [];
  parts.push(audit.analysis.passed ? 'Analysis OK' : 'Analysis FAIL');
  parts.push(audit.db.passed ? 'DB OK' : 'DB FAIL');
  parts.push(audit.vectorStorage.passed ? 'Pinecone OK' : 'Pinecone FAIL');
  return `🛡️ <b>System Health:</b> ${parts.join(', ')}`;
}

export async function sendDailyPulseReport(): Promise<{ ok: boolean; error?: string }> {
  try {
    const [audit, pnlInfo, cioSummary] = await Promise.all([
      runAuditCheck(),
      getLast24hNetPnlUsd(),
      getDailyCioSummary(),
    ]);

    const baseUrl = getBaseUrl();
    const healthLine = formatHealthLine(audit);
    const pnlLine = formatNetPnlLine(pnlInfo.totalNetPnlUsd);
    const summarySafe = escapeHtml(cioSummary || 'No CIO insight available today.');

    const lines: string[] = [];
    lines.push('🚀 <b>Mon Chéri Quant AI — Hedge Fund Pulse</b> 🚀');
    lines.push('');
    lines.push(healthLine);
    lines.push(pnlLine);
    lines.push(`🧠 <b>CIO Insight:</b> ${summarySafe}`);
    lines.push('');
    if (baseUrl) {
      const diagUrl = `${baseUrl}/ops/diagnostics`;
      lines.push(`📈 <a href="${escapeHtml(diagUrl)}">View Diagnostics Dashboard</a>`);
    }

    const text = lines.join('\n');
    const result = await sendTelegramMessage(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: getDashboardReportKeyboard(baseUrl),
    });

    if (result.ok) {
      return { ok: true };
    }
    return { ok: false, error: result.error || 'Telegram send failed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

