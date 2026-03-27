import { sendTelegramMessage } from '@/lib/telegram';

export type AlertSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
}

type AlertSink = (payload: AlertPayload) => void | Promise<void>;

const defaultConsoleSink: AlertSink = (payload) => {
  const header = `[MON-CHERI ALERT][${payload.severity}] ${payload.title}`;
  const body = `${payload.message}\n@ ${payload.timestamp}`;
  console.log(`${header}\n${body}`);
};

const severityIcon: Record<AlertSeverity, string> = {
  INFO: '🟢',
  SUCCESS: '🟢',
  WARNING: '⚠️',
  CRITICAL: '🔴',
};

const escapeMarkdown = (text: string): string =>
  text.replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, '\\$1');

const telegramSink: AlertSink = async (payload) => {
  const message = [
    `${severityIcon[payload.severity]} *${escapeMarkdown(payload.severity)} Alert*`,
    `Title: ${escapeMarkdown(payload.title)}`,
    `Message: ${escapeMarkdown(payload.message)}`,
    `Time: \`${escapeMarkdown(payload.timestamp)}\``,
  ].join('\n');

  await sendTelegramMessage(message, { parse_mode: 'Markdown', disable_web_page_preview: true });
};

// Add a single line below to register any future sink (Telegram, Resend, etc).
const alertSinks: AlertSink[] = [defaultConsoleSink, telegramSink];

export async function dispatchCriticalAlert(
  title: string,
  message: string,
  severity: AlertSeverity
): Promise<void> {
  const payload: AlertPayload = {
    title: title.trim(),
    message: message.trim(),
    severity,
    timestamp: new Date().toISOString(),
  };

  await Promise.allSettled(alertSinks.map((sink) => sink(payload)));
}
