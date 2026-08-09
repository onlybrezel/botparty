import type { Logger } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

let tracingSdk: NodeSDK | null = null;
let tracingStarted = false;

function isTracingEnabled(): boolean {
  return (process.env['OTEL_ENABLED'] ?? '').trim().toLowerCase() === 'true';
}

function buildTraceExporter(): OTLPTraceExporter | undefined {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  if (!endpoint) {
    return undefined;
  }

  const normalized = endpoint.replace(/\/$/, '');
  const url = normalized.endsWith('/v1/traces') ? normalized : `${normalized}/v1/traces`;
  return new OTLPTraceExporter({ url });
}

export async function initTracing(logger: Logger): Promise<void> {
  if (!isTracingEnabled() || tracingStarted) {
    return;
  }

  const traceExporter = buildTraceExporter();
  tracingSdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env['OTEL_SERVICE_NAME']?.trim() || 'botparty-api',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env['npm_package_version']?.trim() || '0.1.0',
    }),
    ...(traceExporter === undefined ? {} : { traceExporter }),
    instrumentations: [new PrismaInstrumentation(), getNodeAutoInstrumentations()],
  });

  await tracingSdk.start();
  tracingStarted = true;
  logger.log('OpenTelemetry tracing enabled');
}

export async function shutdownTracing(logger: Logger): Promise<void> {
  if (!tracingSdk) {
    return;
  }

  try {
    await tracingSdk.shutdown();
  } catch (error) {
    logger.error(`Failed to shutdown OpenTelemetry tracing: ${(error as Error).message}`);
  } finally {
    tracingSdk = null;
    tracingStarted = false;
  }
}
