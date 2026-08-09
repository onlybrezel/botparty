import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_QUEUE_WEBHOOK, type WebhookJobData } from '../jobs/jobs.constants';
import { assertSafeWebhookTarget } from '../common/webhook-target';
import { readNonNegativeIntegerEnv } from '../common/config-number';
import { AeadCipher } from '../common/aead-cipher';
import { Prisma } from '@botparty/prisma';
type RobotWebhookDatabase = {
  $transaction: PrismaService['$transaction'];
  robot: Pick<PrismaService['robot'], 'findUnique'>;
  robotWebhook: Pick<PrismaService['robotWebhook'], 'delete' | 'findFirst' | 'findMany'>;
};
interface WebhookConfig { get(key: string): string | undefined; }

type RobotWebhookEvent =
  | 'robot.online'
  | 'robot.offline'
  | 'session.started'
  | 'session.ended';

type WebhookPayload = Record<string, unknown>;

@Injectable()
export class RobotWebhookService {
  private readonly logger = new Logger(RobotWebhookService.name);
  private readonly secretCipher: AeadCipher;
  private readonly maxWebhooksPerRobot: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: RobotWebhookDatabase,
    @Inject(ConfigService) private readonly config: WebhookConfig,
    @InjectQueue(JOBS_QUEUE_WEBHOOK) private readonly webhookQueue: Pick<Queue<WebhookJobData>, 'addBulk'>,
  ) {
    const explicitKey = this.config.get('WEBHOOK_SECRET_ENCRYPTION_KEY')?.trim();
    if (explicitKey) {
      this.secretCipher = new AeadCipher(
        explicitKey,
        (this.config.get('WEBHOOK_SECRET_ENCRYPTION_KEY_PREVIOUS') ?? '')
          .split(',')
          .map((key) => key.trim()),
      );
    } else if (process.env['NODE_ENV'] === 'production') {
      throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY is required in production');
    } else {
      this.secretCipher = new AeadCipher(
        this.config.get('JWT_SECRET')?.trim() ||
          'botparty-webhook-secret-fallback-32-characters',
      );
      this.logger.warn(
        'WEBHOOK_SECRET_ENCRYPTION_KEY not set — falling back to JWT_SECRET (dev only).',
      );
    }
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
    let target: URL;
    try {
      target = await assertSafeWebhookTarget(input.url);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const id = randomUUID();
    const plainSecret = randomBytes(32).toString('hex');
    const hook = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${robotId}::uuid FOR UPDATE`);
      if (this.maxWebhooksPerRobot > 0) {
        const existingHooks = await tx.robotWebhook.count({ where: { robotId } });
        if (existingHooks >= this.maxWebhooksPerRobot) {
          throw new BadRequestException(
            `Maximum of ${this.maxWebhooksPerRobot} webhooks allowed per robot`,
          );
        }
      }
      return tx.robotWebhook.create({
        data: {
          id,
          robotId,
          url: target.toString(),
          events: Array.from(new Set(input.events)),
          isActive: input.isActive ?? true,
          secret: this.encryptWebhookSecret(id, plainSecret),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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

    const dedupeWindow = Math.floor(Date.now() / 30_000);
    this.dispatch(robot.id, event, `${event}:${robot.id}:${dedupeWindow}`, {
      robot: {
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: robot.status,
      },
    });
  }

  emitSessionStarted(session: { id: string; robotId: string; userId: string; startedAt: Date }) {
    this.dispatch(session.robotId, 'session.started', `session.started:${session.id}`, {
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
    this.dispatch(session.robotId, 'session.ended', `session.ended:${session.id}`, {
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

  private dispatch(
    robotId: string,
    event: RobotWebhookEvent,
    dedupeKey: string,
    payload: WebhookPayload,
  ) {
    queueMicrotask(() => {
      void this.enqueueWebhookJobs(robotId, event, dedupeKey, payload).catch((error) => {
        this.logger.error(
          `Failed to enqueue ${event} webhooks for robot ${robotId}: ${(error as Error).message}`,
        );
      });
    });
  }

  private async enqueueWebhookJobs(
    robotId: string,
    event: RobotWebhookEvent,
    dedupeKey: string,
    payload: WebhookPayload,
  ) {
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
          jobId: `webhook-${hook.id}-${createHash('sha256').update(dedupeKey).digest('hex')}`,
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
      throw new NotFoundException('Robot not found');
    }
  }

  private encryptWebhookSecret(webhookId: string, plainSecretHex: string): string {
    return this.secretCipher.encrypt(plainSecretHex, `robot-webhook:${webhookId}`);
  }

  private decryptWebhookSecret(webhookId: string, storedSecret: string): string {
    return this.secretCipher.decrypt(storedSecret, `robot-webhook:${webhookId}`).plaintext;
  }
}
