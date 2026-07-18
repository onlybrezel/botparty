import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'stream';

const DEFAULT_PAYMENT_WEBHOOK_BODY_LIMIT = 256 * 1024;

function isPaymentWebhookPath(url: string) {
  return url.startsWith('/api/v1/billing/webhooks/');
}

export function installPaymentRawBodyCapture(fastify: FastifyInstance, configuredLimit?: number) {
  const bodyLimit = Math.max(
    1_024,
    Math.min(configuredLimit ?? DEFAULT_PAYMENT_WEBHOOK_BODY_LIMIT, 1_048_576),
  );
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (!isPaymentWebhookPath(request.url)) return payload;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > bodyLimit) {
        const error = new Error('Payment webhook payload is too large.') as Error & {
          code: string;
          statusCode: number;
        };
        error.code = 'FST_ERR_CTP_BODY_TOO_LARGE';
        error.statusCode = 413;
        throw error;
      }
      chunks.push(buffer);
    }
    const rawBody = Buffer.concat(chunks);
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = rawBody;
    const replacement = Readable.from(rawBody) as Readable & { receivedEncodedLength?: number };
    replacement.receivedEncodedLength = rawBody.length;
    return replacement;
  });
}
