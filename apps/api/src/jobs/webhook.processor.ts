import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_QUEUE_WEBHOOK, type WebhookJobData } from './jobs.constants';
import { postWebhookSafely } from '../common/webhook-target';
import { AeadCipher } from '../common/aead-cipher';

@Processor(JOBS_QUEUE_WEBHOOK, { concurrency: 4 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);
  private readonly secretCipher: AeadCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    const explicitKey = this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY')?.trim();
    if (explicitKey) {
      this.secretCipher = new AeadCipher(
        explicitKey,
        (this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY_PREVIOUS') ?? '')
          .split(',')
          .map((key) => key.trim()),
      );
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY is required in production');
    } else {
      this.secretCipher = new AeadCipher(
        this.config.get<string>('JWT_SECRET')?.trim() ||
          'botparty-webhook-secret-fallback-32-characters',
      );
      this.logger.warn(
        'WEBHOOK_SECRET_ENCRYPTION_KEY not set — falling back to JWT_SECRET (dev only).',
      );
    }
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
      const response = await postWebhookSafely(
        hook.url,
        body,
        {
          'content-type': 'application/json',
          'user-agent': 'BotParty-Webhooks/1.0',
          'x-botparty-event': event,
          'x-botparty-delivery-id': deliveryId,
          'x-botparty-signature': `sha256=${signature}`,
        },
        { timeoutMs: 8_000, maxRedirects: 3 },
      );

      await this.prisma.robotWebhook.update({
        where: { id: hook.id },
        data: { lastTriggeredAt: new Date(), lastStatusCode: response.status },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Webhook delivery failed for ${hook.id}: ${(error as Error).message}`);
      try {
        await this.prisma.robotWebhook.update({
          where: { id: hook.id },
          data: { lastTriggeredAt: new Date(), lastStatusCode: null },
        });
      } catch (statusError) {
        this.logger.error(
          `Failed to persist webhook failure state for ${hook.id}: ${(statusError as Error).message}`,
        );
      }
      throw error; // Let BullMQ handle retries
    }
  }

  private _decryptSecret(webhookId: string, storedSecret: string): string {
    return this.secretCipher.decrypt(storedSecret, `robot-webhook:${webhookId}`).plaintext;
  }
}
