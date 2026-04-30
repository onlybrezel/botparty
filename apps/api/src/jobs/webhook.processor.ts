import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_QUEUE_WEBHOOK, type WebhookJobData } from './jobs.constants';
import { assertSafeWebhookTarget } from '../common/webhook-target';

@Processor(JOBS_QUEUE_WEBHOOK, { concurrency: 4 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);
  private readonly secretKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    this.secretKey =
      this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      'botparty-webhook-secret-fallback';
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { hookId, event, payload } = job.data;

    const hook = await this.prisma.robotWebhook.findUnique({ where: { id: hookId } });
    if (!hook || !hook.isActive) {
      return;
    }

    const occurredAt = new Date().toISOString();
    const deliveryId = randomUUID();
    const body = JSON.stringify({ id: deliveryId, event, occurredAt, ...payload });
    const signingSecret = this._decryptSecret(hook.id, hook.secret);
    const signature = createHmac('sha256', signingSecret).update(body).digest('hex');

    try {
      const target = await assertSafeWebhookTarget(hook.url);
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'BotParty-Webhooks/1.0',
          'x-botparty-event': event,
          'x-botparty-delivery-id': deliveryId,
          'x-botparty-signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });

      await this.prisma.robotWebhook.update({
        where: { id: hook.id },
        data: { lastTriggeredAt: new Date(), lastStatusCode: response.status },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Webhook delivery failed for ${hook.id}: ${(error as Error).message}`);
      await this.prisma.robotWebhook.update({
        where: { id: hook.id },
        data: { lastTriggeredAt: new Date(), lastStatusCode: null },
      }).catch(() => {});
      throw error; // Let BullMQ handle retries
    }
  }

  private _decryptSecret(webhookId: string, storedSecret: string): string {
    // Backward compatibility: plaintext legacy secrets are stored as 64-char hex strings.
    if (/^[a-f0-9]{64}$/i.test(storedSecret)) {
      return storedSecret;
    }

    const encrypted = Buffer.from(storedSecret, 'base64url');
    const keyStream = createHmac('sha256', this.secretKey).update(webhookId).digest();
    const decrypted = Buffer.alloc(encrypted.length);
    for (let i = 0; i < encrypted.length; i += 1) {
      decrypted[i] = encrypted[i]! ^ keyStream[i % keyStream.length]!;
    }
    return decrypted.toString('hex');
  }
}
