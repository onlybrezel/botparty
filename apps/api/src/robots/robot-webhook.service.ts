import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_QUEUE_WEBHOOK, type WebhookJobData } from '../jobs/jobs.constants';
import { assertSafeWebhookTarget } from '../common/webhook-target';
import { readNonNegativeIntegerEnv } from '../common/config-number';

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
  private readonly maxWebhooksPerRobot: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(JOBS_QUEUE_WEBHOOK) private readonly webhookQueue: Queue<WebhookJobData>,
  ) {
    this.webhookSecretKey =
      this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      'botparty-webhook-secret-fallback';
    this.maxWebhooksPerRobot = readNonNegativeIntegerEnv(this.config, 'MAX_WEBHOOKS_PER_ROBOT', 10);
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
    if (this.maxWebhooksPerRobot > 0) {
      const existingHooks = await this.prisma.robotWebhook.count({ where: { robotId } });
      if (existingHooks >= this.maxWebhooksPerRobot) {
        throw new BadRequestException(
          `Maximum of ${this.maxWebhooksPerRobot} webhooks allowed per robot`,
        );
      }
    }
    let target: URL;
    try {
      target = await assertSafeWebhookTarget(input.url);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const id = randomUUID();
    const plainSecret = randomBytes(32).toString('hex');
    const hook = await this.prisma.robotWebhook.create({
      data: {
        id,
        robotId,
        url: target.toString(),
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
      lastTriggeredAt: null,
      lastStatusCode: null,
      secretPreview: `${plainSecret.slice(0, 8)}...`,
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
      void this.enqueueWebhookJobs(robotId, event, payload);
    });
  }

  private async enqueueWebhookJobs(robotId: string, event: RobotWebhookEvent, payload: WebhookPayload) {
    const hooks = await this.prisma.robotWebhook.findMany({
      where: {
        robotId,
        isActive: true,
        events: { has: event },
      },
      select: { id: true },
    });

    if (hooks.length === 0) {
      return;
    }

    await this.webhookQueue.addBulk(
      hooks.map((hook) => ({
        name: 'deliver',
        data: {
          hookId: hook.id,
          event,
          payload,
        },
        opts: {
          attempts: 4,
          backoff: { type: 'exponential', delay: 500 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      })),
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
