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

  constructor(private readonly prisma: PrismaService) {}

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
      secretPreview: `${hook.secret.slice(0, 8)}...`,
    }));
  }

  async createForOwner(
    robotId: string,
    ownerId: string,
    input: { url: string; events: RobotWebhookEvent[]; isActive?: boolean },
  ) {
    await this.assertOwner(robotId, ownerId);
    const hook = await this.prisma.robotWebhook.create({
      data: {
        robotId,
        url: input.url.trim(),
        events: Array.from(new Set(input.events)),
        isActive: input.isActive ?? true,
        secret: randomBytes(32).toString('hex'),
      },
    });

    return {
      id: hook.id,
      url: hook.url,
      events: hook.events,
      isActive: hook.isActive,
      secret: hook.secret,
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
        const signature = createHmac('sha256', hook.secret).update(body).digest('hex');

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
}