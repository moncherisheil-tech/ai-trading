import { sendTelegramMessage, escapeHtml, getDashboardReportKeyboard } from '@/lib/telegram';
import { getBaseUrl } from '@/lib/config';

export async function sendWorkerFailureAlert(workerName: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = escapeHtml(message).slice(0, 1200);
  const baseUrl = getBaseUrl();
  const text = [
    '🚨 <b>System Alert</b>',
    '',
    `<b>Worker:</b> ${escapeHtml(workerName)}`,
    `<b>Error:</b> <code>${safeMessage}</code>`,
    '',
    'נדרש טיפול מיידי בלוח הבקרה.',
  ].join('\n');
  await sendTelegramMessage(text, {
    parse_mode: 'HTML',
    reply_markup: getDashboardReportKeyboard(baseUrl),
  }).catch(() => {});
}
