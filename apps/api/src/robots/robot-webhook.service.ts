import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export const ROBOT_WEBHOOK_EVENTS = [
  'robot.online',
  'robot.offline',
  'session.started',
  'session.ended',
] as const;

export type RobotWebhookEvent = (typeof ROBOT_WEBHOOK_EVENTS)[number];

type WebhookPayload = Record<string, unknown>;

@Injectable()
export class RobotWebhookService {
  private readonly logger = new Logger(RobotWebhookService.name);
  private readonly webhookSecretKey: string;

  constructor(private readonly prisma: PrismaService) {
    this.webhookSecretKey =
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim() ||
      process.env.JWT_SECRET?.trim() ||
      'botparty-webhook-secret-fallback';
  }

  async listForOwner(robotId: string, ownerId: string) {
    await this.assertOwner(robotId, ownerId);
    const hooks = await this.prisma.robotWebhook.findMany({
      where: { robotId },
      orderBy: { createdAt: 'desc' },
    });

    return hooks.map((hook) => ({
      id: hook.id,
      url: hook.url,
      events: hook.events,
      isActive: hook.isActive,
      lastTriggeredAt: hook.lastTriggeredAt?.toISOString() ?? null,
      lastStatusCode: hook.lastStatusCode,
      createdAt: hook.createdAt.toISOString(),
      secretPreview: `${this.decryptWebhookSecret(hook.id, hook.secret).slice(0, 8)}...`,
    }));
  }

  async createForOwner(
    robotId: string,
    ownerId: string,
    input: { url: string; events: RobotWebhookEvent[]; isActive?: boolean },
  ) {
    await this.assertOwner(robotId, ownerId);
    const id = randomUUID();
    const plainSecret = randomBytes(32).toString('hex');
    const hook = await this.prisma.robotWebhook.create({
      data: {
        id,
        robotId,
        url: input.url.trim(),
        events: Array.from(new Set(input.events)),
        isActive: input.isActive ?? true,
        secret: this.encryptWebhookSecret(id, plainSecret),
      },
    });

    return {
      id: hook.id,
      url: hook.url,
      events: hook.events,
      isActive: hook.isActive,
      secret: plainSecret,
      createdAt: hook.createdAt.toISOString(),
    };
  }

  async deleteForOwner(robotId: string, ownerId: string, webhookId: string) {
    await this.assertOwner(robotId, ownerId);
    const hook = await this.prisma.robotWebhook.findFirst({ where: { id: webhookId, robotId } });
    if (!hook) {
      throw new NotFoundException('Webhook not found');
    }

    await this.prisma.robotWebhook.delete({ where: { id: hook.id } });
  }

  emitRobotStatus(robot: { id: string; name: string; slug: string; status: string }) {
    const event = robot.status === 'ONLINE'
      ? 'robot.online'
      : robot.status === 'OFFLINE'
        ? 'robot.offline'
        : null;
    if (!event) {
      return;
    }

    this.dispatch(robot.id, event, {
      robot: {
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: robot.status,
      },
    });
  }

  emitSessionStarted(session: { id: string; robotId: string; userId: string; startedAt: Date }) {
    this.dispatch(session.robotId, 'session.started', {
      session: {
        id: session.id,
        robotId: session.robotId,
        userId: session.userId,
        startedAt: session.startedAt.toISOString(),
      },
    });
  }

  emitSessionEnded(session: {
    id: string;
    robotId: string;
    userId: string;
    startedAt: Date;
    endedAt: Date | null;
    durationMs: number | null;
  }) {
    this.dispatch(session.robotId, 'session.ended', {
      session: {
        id: session.id,
        robotId: session.robotId,
        userId: session.userId,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        durationMs: session.durationMs,
      },
    });
  }

  private dispatch(robotId: string, event: RobotWebhookEvent, payload: WebhookPayload) {
    queueMicrotask(() => {
      void this.deliver(robotId, event, payload);
    });
  }

  private async deliver(robotId: string, event: RobotWebhookEvent, payload: WebhookPayload) {
    const hooks = await this.prisma.robotWebhook.findMany({
      where: {
        robotId,
        isActive: true,
        events: { has: event },
      },
    });
    if (hooks.length === 0) {
      return;
    }

    await Promise.allSettled(
      hooks.map(async (hook) => {
        const occurredAt = new Date().toISOString();
        const deliveryId = randomUUID();
        const body = JSON.stringify({
          id: deliveryId,
          event,
          occurredAt,
          ...payload,
        });
        const signingSecret = this.decryptWebhookSecret(hook.id, hook.secret);
        const signature = createHmac('sha256', signingSecret).update(body).digest('hex');

        try {
          const response = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'user-agent': 'BotParty-Webhooks/1.0',
              'x-botparty-event': event,
              'x-botparty-delivery-id': deliveryId,
              'x-botparty-signature': `sha256=${signature}`,
            },
            body,
            signal: AbortSignal.timeout(5000),
          });

          await this.prisma.robotWebhook.update({
            where: { id: hook.id },
            data: {
              lastTriggeredAt: new Date(),
              lastStatusCode: response.status,
            },
          });
        } catch (error) {
          this.logger.warn(`Webhook delivery failed for ${hook.id}: ${(error as Error).message}`);
          await this.prisma.robotWebhook.update({
            where: { id: hook.id },
            data: {
              lastTriggeredAt: new Date(),
              lastStatusCode: null,
            },
          });
        }
      }),
    );
  }

  private async assertOwner(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { ownerId: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }
  }

  private encryptWebhookSecret(webhookId: string, plainSecretHex: string): string {
    const plain = Buffer.from(plainSecretHex, 'hex');
    const keyStream = createHmac('sha256', this.webhookSecretKey).update(webhookId).digest();
    const encrypted = Buffer.alloc(plain.length);
    for (let index = 0; index < plain.length; index += 1) {
      const plainByte = plain[index] ?? 0;
      const keyByte = keyStream[index % keyStream.length] ?? 0;
      encrypted[index] = plainByte ^ keyByte;
    }
    return encrypted.toString('base64url');
  }

  private decryptWebhookSecret(webhookId: string, storedSecret: string): string {
    // Backward compatibility: plaintext legacy secrets are 64-char hex strings.
    if (/^[a-f0-9]{64}$/i.test(storedSecret)) {
      return storedSecret;
    }

    const encrypted = Buffer.from(storedSecret, 'base64url');
    const keyStream = createHmac('sha256', this.webhookSecretKey).update(webhookId).digest();
    const decrypted = Buffer.alloc(encrypted.length);
    for (let index = 0; index < encrypted.length; index += 1) {
      const encryptedByte = encrypted[index] ?? 0;
      const keyByte = keyStream[index % keyStream.length] ?? 0;
      decrypted[index] = encryptedByte ^ keyByte;
    }

    return decrypted.toString('hex');
  }
}