/**
 * RTL-compliant report print: opens a new window with UTF-8 + lang="he" dir="rtl"
 * so Hebrew renders correctly. User can "Save as PDF" from the print dialog.
 * Replaces JsPDF text (which breaks Hebrew due to missing font support).
 */

export const REPORT_BRANDING = 'Smart Money & Mon Chéri Group';
export const REPORT_LEGAL_DISCLAIMER =
  'המידע בדוח זה נוצר על ידי מערכת Smart Money ומיועד למטרות לימוד וסימולציה בלבד. אין לראות בו ייעוץ השקעות או המלצה לפעולה. המסחר במטבעות קריפטוגרפיים כרוך בסיכון.';

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 15mm; font-family: system-ui, "Segoe UI", sans-serif; font-size: 11pt; color: #e4e4e7; background: #0f172a; }
  .report { max-width: 210mm; margin: 0 auto; }
  h1 { font-size: 18pt; margin: 0 0 8px 0; color: #22d3ee; }
  h2 { font-size: 12pt; margin: 16px 0 8px 0; color: #5eead4; border-bottom: 1px solid rgba(34,211,238,0.3); padding-bottom: 4px; }
  .meta { font-size: 9pt; color: #94a3b8; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin: 12px 0; }
  .cell { background: rgba(15,23,42,0.8); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(51,65,85,0.6); }
  .cell .label { font-size: 9pt; color: #94a3b8; }
  .cell .value { font-size: 12pt; font-weight: 600; }
  .positive { color: #34d399; }
  .negative { color: #f43f5e; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }
  th, td { padding: 6px 8px; text-align: right; border-bottom: 1px solid rgba(71,85,105,0.5); }
  th { color: #94a3b8; font-weight: 600; }
  .analysis-box { border: 1px solid rgba(34,211,238,0.4); border-radius: 8px; padding: 12px; margin: 16px 0; background: rgba(7,25,45,0.6); }
  .analysis-box h3 { margin: 0 0 8px 0; font-size: 11pt; color: #5eead4; }
  .signature { font-size: 8pt; color: #22d3ee; margin-top: 12px; }
  .disclaimer { font-size: 8pt; color: #64748b; margin-top: 16px; padding-top: 8px; border-top: 1px solid rgba(71,85,105,0.5); }
  @media print { body { background: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export type PnlPrintRow = {
  date: string;
  symbol: string;
  direction: string;
  pnl: number;
  win: boolean;
};

export type ReportPrintParams = {
  title: string;
  timestamp: string;
  /** When 'performance', first metric is "תשואה מצטברת" (totalPnlPct); otherwise "תיק" (balance). */
  reportType?: 'pnl' | 'performance';
  leverage?: number;
  balance?: number;
  totalPnl?: number;
  totalPnlPct?: number;
  winRatePct?: number;
  profitFactor?: number | string;
  sharpeRatio?: number | string;
  maxDrawdown?: number;
  maxDrawdownPct?: number;
  topStrategies?: Array<{ symbol: string; pnl: number; wins: number; count: number }>;
  trades?: PnlPrintRow[];
  /** Executive summary in Hebrew. When built from a prediction, include MoE consensus + macro_logic (מקרו/Order Book) when present. */
  analysisHe?: string;
};

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function buildReportBody(params: ReportPrintParams): string {
  const {
    title,
    timestamp,
    reportType = 'pnl',
    leverage = 1,
    balance = 0,
    totalPnl = 0,
    totalPnlPct = 0,
    winRatePct = 0,
    profitFactor = 'N/A',
    sharpeRatio = 'N/A',
    maxDrawdown = 0,
    maxDrawdownPct = 0,
    topStrategies = [],
    trades = [],
    analysisHe,
  } = params;

  const pfStr = typeof profitFactor === 'number' ? profitFactor.toFixed(2) : String(profitFactor);
  const sharpeStr = typeof sharpeRatio === 'number' ? sharpeRatio.toFixed(2) : String(sharpeRatio);

  const isPerformanceOnly = reportType === 'performance';
  const firstCellLabel = isPerformanceOnly ? 'תשואה מצטברת' : 'תיק';
  const firstCellValue = isPerformanceOnly
    ? `<span class="${totalPnlPct >= 0 ? 'positive' : 'negative'}">${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%</span>`
    : `$${balance.toFixed(2)}`;
  const metaLine = leverage ? `${escapeHtml(timestamp)} · מינוף ${leverage}x` : escapeHtml(timestamp);

  let html = `
    <div class="report">
      <h1>${escapeHtml(REPORT_BRANDING)}</h1>
      <p class="meta">${metaLine}</p>
      <h2>${isPerformanceOnly ? 'סיכום ביצועי מערכת' : 'סיכום תיק ורווח/הפסד'}</h2>
      <div class="grid">
        <div class="cell"><div class="label">${firstCellLabel}</div><div class="value">${firstCellValue}</div></div>
        <div class="cell"><div class="label">רווח/הפסד</div><div class="value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)</div></div>
        <div class="cell"><div class="label">אחוז הצלחה</div><div class="value">${winRatePct.toFixed(1)}%</div></div>
        <div class="cell"><div class="label">מקדם רווח</div><div class="value">${pfStr}</div></div>
        <div class="cell"><div class="label">מדד יציבות (שרפ)</div><div class="value">${sharpeStr}</div></div>
        <div class="cell"><div class="label">משיכה מקסימלית</div><div class="value negative">$${maxDrawdown.toFixed(2)} (${maxDrawdownPct.toFixed(1)}%)</div></div>
      </div>`;

  if (topStrategies.length > 0) {
    html += `<h2>אסטרטגיות מובילות</h2><ul style="margin:8px 0;padding-right:20px;">`;
    topStrategies.slice(0, 5).forEach((s, i) => {
      html += `<li>${i + 1}. ${escapeHtml(s.symbol)}: $${s.pnl.toFixed(2)} (${s.wins}/${s.count})</li>`;
    });
    html += `</ul>`;
  }

  if (trades.length > 0) {
    html += `<h2>עסקאות (${trades.length})</h2>
      <table>
        <thead><tr><th>תאריך</th><th>סמל</th><th>כיוון</th><th>רווח/הפסד</th><th>הצלחה</th></tr></thead>
        <tbody>`;
    trades.slice(0, 100).forEach((t) => {
      html += `<tr>
        <td>${escapeHtml(t.date)}</td>
        <td>${escapeHtml(t.symbol)}</td>
        <td>${escapeHtml(t.direction)}</td>
        <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
        <td>${t.win ? 'כן' : 'לא'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  if (analysisHe && analysisHe.trim()) {
    html += `
      <div class="analysis-box">
        <h3>ניתוח מנהלים (Executive Analysis)</h3>
        <p>${escapeHtml(analysisHe)}</p>
        <p class="signature">נכתב ע"י Smart Money AI — מחלקת מחקר, קבוצת Mon Chéri. כולל קונצנזוס MoE (טכני, סיכון, פסיכו, מקרו/Order Book).</p>
      </div>`;
  }

  html += `<p class="disclaimer">${escapeHtml(REPORT_LEGAL_DISCLAIMER)}</p></div>`;
  return html;
}

/**
 * Opens a new window with the report HTML (UTF-8, lang="he", dir="rtl") and triggers print.
 * User can choose "Save as PDF" in the print dialog. Hebrew renders correctly.
 */
export function openReportPrintWindow(params: ReportPrintParams): void {
  const bodyContent = buildReportBody(params);
  const doc = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(params.title)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
${bodyContent}
</body>
</html>`;

  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) {
    console.error('[print-report] Popup blocked');
    return;
  }
  w.document.write(doc);
  w.document.close();
  w.focus();
  w.onload = () => {
    try {
      w.print();
      w.onafterprint = () => w.close();
    } catch {
      w.close();
    }
  };
}
