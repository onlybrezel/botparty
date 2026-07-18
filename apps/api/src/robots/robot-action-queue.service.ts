import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RobotAccessService } from './robot-access.service';
import type { RobotActionPayload } from './robots.types';

@Injectable()
export class RobotActionQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly access: RobotAccessService,
  ) {}

  async enqueueAction(robotId: string, ownerId: string, payload: RobotActionPayload) {
    const robot = await this.findRobot(robotId);
    if (robot.ownerId !== ownerId) {
      throw new NotFoundException('Robot not found');
    }

    return this.enqueueActionForExistingRobot(robot.id, payload);
  }

  async enqueueActionForRobot(robotId: string, payload: RobotActionPayload) {
    const robot = await this.findRobot(robotId);
    return this.enqueueActionForExistingRobot(robot.id, payload);
  }

  async getPendingActions(robotId: string, ownerId: string) {
    const robot = await this.findRobot(robotId);
    if (robot.ownerId !== ownerId) {
      throw new NotFoundException('Robot not found');
    }

    return {
      robotId,
      actions: await this.readActions(robotId),
    };
  }

  async consumeActionsByRobotId(robotId: string) {
    const robot = await this.findRobot(robotId);
    const key = this.actionKey(robot.id);
    const raw = await this.redis.lrange(key, 0, -1);
    const stream = await this.access.getStreamPolicy(robot.id);

    if (raw.length === 0) {
      return {
        robotId: robot.id,
        stream,
        actions: [] as Array<Record<string, unknown>>,
      };
    }

    await this.redis.del(key);
    return {
      robotId: robot.id,
      stream,
      actions: this.parseActions(raw),
    };
  }

  private async enqueueActionForExistingRobot(robotId: string, payload: RobotActionPayload) {
    const key = this.actionKey(robotId);
    const queued = await this.redis.lrange(key, 0, -1);
    const existing = this.parseActions(queued).find((entry) => entry.type === payload.type);

    if (existing) {
      return {
        id: typeof existing.id === 'string' ? existing.id : randomBytes(8).toString('hex'),
        type: String(existing.type),
        createdAt: typeof existing.createdAt === 'number' ? existing.createdAt : Date.now(),
        alreadyQueued: true,
      };
    }

    const action = {
      id: randomBytes(8).toString('hex'),
      type: payload.type,
      durationSec: payload.durationSec,
      createdAt: Date.now(),
      alreadyQueued: false,
    };

    if (payload.type === 'set_log_stream') {
      await this.redis.del(`robot:logs:${robotId}`);
    }

    await this.redis.rpush(key, JSON.stringify(action));
    await this.redis.ltrim(key, -50, -1);
    await this.redis.expire(key, 900);
    return action;
  }

  private async findRobot(robotId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    return robot;
  }

  private async readActions(robotId: string): Promise<Array<Record<string, unknown>>> {
    const raw = await this.redis.lrange(this.actionKey(robotId), 0, -1);
    return this.parseActions(raw);
  }

  private parseActions(raw: string[]): Array<Record<string, unknown>> {
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  private actionKey(robotId: string): string {
    return `robot:actions:${robotId}`;
  }
}
