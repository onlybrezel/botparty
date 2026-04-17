import { Logger } from '@nestjs/common';

let sentryEnabled = false;
let sentryClient: { captureException: (error: unknown) => void } | null = null;

export async function initSentry(logger: Logger): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }

  try {
    const moduleName = '@sentry/node';
    const sentry = (await import(moduleName)) as {
      init: (options: Record<string, unknown>) => void;
      captureException: (error: unknown) => void;
    };

    sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.APP_VERSION ?? 'dev',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.05'),
    });

    sentryClient = { captureException: sentry.captureException };
    sentryEnabled = true;
    logger.log('Sentry initialized');
  } catch (error) {
    logger.warn(`Sentry DSN set but @sentry/node is unavailable: ${String(error)}`);
  }
}

export function captureException(error: unknown): void {
  if (!sentryEnabled || !sentryClient) {
    return;
  }

  try {
    sentryClient.captureException(error);
  } catch {
    // Never fail request handling due to telemetry reporting issues.
  }
}
