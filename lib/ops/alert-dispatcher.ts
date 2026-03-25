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

// Add a single line below to register any future sink (Telegram, Resend, etc).
const alertSinks: AlertSink[] = [defaultConsoleSink];

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
