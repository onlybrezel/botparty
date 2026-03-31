import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async join(robotId: string, userId: string, isPriority = false) {
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
    const entries = await this.prisma.queueEntry.findMany({
      where: { robotId },
      orderBy: [{ isPriority: 'desc' }, { position: 'asc' }],
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
    return this.prisma.queueEntry.findMany({
      where: { robotId },
      orderBy: [{ isPriority: 'desc' }, { position: 'asc' }],
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async getNextInQueue(robotId: string) {
    return this.prisma.queueEntry.findFirst({
      where: { robotId },
      orderBy: [{ isPriority: 'desc' }, { position: 'asc' }],
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });
  }

  async vote(robotId: string, targetUserId: string) {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { robotId_userId: { robotId, userId: targetUserId } },
    });
    if (!entry) return null;

    return this.prisma.queueEntry.update({
      where: { id: entry.id },
      data: { votes: { increment: 1 } },
    });
  }

  async clearQueue(robotId: string) {
    await this.prisma.queueEntry.deleteMany({ where: { robotId } });
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'clear' }));
  }
}
