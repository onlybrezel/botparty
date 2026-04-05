import { Injectable, ConflictException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RobotsService } from '../robots/robots.service';
import type { Prisma } from '@botparty/prisma';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly robotsService: RobotsService,
  ) {}

  async join(robotId: string, userId: string, isPriority = false) {
    const access = await this.robotsService.getAccessPolicy(robotId);
    if (access.control === 'DISABLED') {
      throw new ForbiddenException('Control is disabled for this robot');
    }

    // Check if already in queue
    const existing = await this.prisma.queueEntry.findUnique({
      where: { robotId_userId: { robotId, userId } },
    });
    if (existing) throw new ConflictException('Already in queue');

    // Get next position
    const lastEntry = await this.prisma.queueEntry.findFirst({
      where: { robotId },
      orderBy: { position: 'desc' },
    });
    const position = (lastEntry?.position ?? 0) + 1;

    const entry = await this.prisma.queueEntry.create({
      data: { robotId, userId, position, isPriority },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Publish queue update via Redis for real-time sync
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'join', entry }));

    this.logger.log(`User ${userId} joined queue for robot ${robotId} at position ${position}`);
    return entry;
  }

  async leave(robotId: string, userId: string) {
    await this.prisma.queueEntry.delete({
      where: { robotId_userId: { robotId, userId } },
    });

    // Reorder remaining entries
    const orderBy = await this.getQueueOrderBy(robotId);
    const entries = await this.prisma.queueEntry.findMany({
      where: { robotId },
      orderBy,
    });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        await this.prisma.queueEntry.update({
          where: { id: entry.id },
          data: { position: i + 1 },
        });
      }
    }

    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'leave', userId }));
  }

  async getQueue(robotId: string) {
    const orderBy = await this.getQueueOrderBy(robotId);
    return this.prisma.queueEntry.findMany({
      where: { robotId },
      orderBy,
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async getNextInQueue(robotId: string) {
    const orderBy = await this.getQueueOrderBy(robotId);
    return this.prisma.queueEntry.findFirst({
      where: { robotId },
      orderBy,
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });
  }

  async getCurrentControllerUserId(robotId: string): Promise<string | null> {
    const orderBy = await this.getQueueOrderBy(robotId);
    const next = await this.prisma.queueEntry.findFirst({
      where: { robotId },
      orderBy,
      select: { userId: true },
    });

    return next?.userId ?? null;
  }

  async vote(robotId: string, targetUserId: string, voterUserId: string) {
    if (targetUserId === voterUserId) {
      throw new BadRequestException('You cannot vote for yourself');
    }

    const entry = await this.prisma.queueEntry.findUnique({
      where: { robotId_userId: { robotId, userId: targetUserId } },
    });
    if (!entry) return null;

    const voterEntry = await this.prisma.queueEntry.findUnique({
      where: { robotId_userId: { robotId, userId: voterUserId } },
      select: { id: true },
    });
    if (!voterEntry) {
      throw new ForbiddenException('Join the queue to vote');
    }

    const cooldownKey = `queue:vote:${robotId}:${voterUserId}`;
    const voteAllowed = await this.redis.set(cooldownKey, Date.now().toString(), 'EX', 4, 'NX');
    if (voteAllowed !== 'OK') {
      throw new ConflictException('Voting too fast. Please wait a moment.');
    }

    return this.prisma.queueEntry.update({
      where: { id: entry.id },
      data: { votes: { increment: 1 } },
    });
  }

  async clearQueue(robotId: string) {
    await this.prisma.queueEntry.deleteMany({ where: { robotId } });
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'clear' }));
  }

  private async getQueueOrderBy(robotId: string): Promise<Prisma.QueueEntryOrderByWithRelationInput[]> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { queueMode: true },
    });

    if (robot?.queueMode === 'VOTING') {
      return [{ isPriority: 'desc' }, { votes: 'desc' }, { joinedAt: 'asc' }, { position: 'asc' }];
    }

    return [{ isPriority: 'desc' }, { position: 'asc' }, { joinedAt: 'asc' }];
  }
}
