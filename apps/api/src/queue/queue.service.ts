import {
  Injectable,
  ConflictException,
  ForbiddenException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RobotsService } from '../robots/robots.service';
import { Prisma } from '@botparty/prisma';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly robotsService: RobotsService,
  ) {}

  async join(robotId: string, userId: string, roomAccessToken?: string, isPriority = false) {
    const access = await this.robotsService.getAccessPolicy(robotId);
    if (access.control === 'DISABLED') {
      throw new ForbiddenException('Control is disabled for this robot');
    }

    const robot = await this.robotsService.findById(robotId);
    if (robot.status === 'OFFLINE' || robot.status === 'MAINTENANCE') {
      throw new ForbiddenException('This robot is currently offline');
    }

    const allowed = await this.robotsService.validateRoomAccess({
      robotId,
      actorId: userId,
      roomAccessToken,
    });
    if (!allowed) {
      throw new ForbiddenException('Room access verification required');
    }

    const entry = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.queueEntry.findUnique({
          where: { robotId_userId: { robotId, userId } },
        });
        if (existing) throw new ConflictException('Already in queue');

        const lastEntry = await tx.queueEntry.findFirst({
          where: { robotId },
          orderBy: { position: 'desc' },
        });
        const position = (lastEntry?.position ?? 0) + 1;

        return tx.queueEntry.create({
          data: { robotId, userId, position, isPriority },
          include: {
            user: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.removeVotingFootprint(robotId, userId);
    await this.recomputeQueueVotes(robotId);

    // Publish queue update via Redis for real-time sync
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'join', entry }));

    this.logger.log(`User ${userId} joined queue for robot ${robotId} at position ${entry.position}`);
    return entry;
  }

  async leave(robotId: string, userId: string) {
    const orderBy = await this.getQueueOrderBy(robotId);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.queueEntry.findUnique({
          where: { robotId_userId: { robotId, userId } },
          select: { id: true },
        });

        if (!existing) {
          return { removed: false };
        }

        await tx.queueEntry.delete({
          where: { robotId_userId: { robotId, userId } },
        });

        const entries = await tx.queueEntry.findMany({
          where: { robotId },
          orderBy,
          select: { id: true },
        });

        for (const [index, entry] of entries.entries()) {
          await tx.queueEntry.update({
            where: { id: entry.id },
            data: { position: index + 1 },
          });
        }

        return { removed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!result.removed) {
      return result;
    }

    await this.removeVotingFootprint(robotId, userId);
    await this.recomputeQueueVotes(robotId);

    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'leave', userId }));
    return result;
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

  async getQueueForRequester(
    robotId: string,
    requesterUserId: string | null,
    roomAccessToken?: string,
    guestSessionId?: string,
  ) {
    const robot = await this.robotsService.findById(robotId);
    const actorId = requesterUserId ?? this.robotsService.resolveGuestActorId(guestSessionId);
    const accessRequiresVerification =
      robot.visibility === 'PRIVATE' ||
      robot.accessMode === 'PASSWORD' ||
      robot.accessMode === 'ALLOWED_USERS';

    if (accessRequiresVerification) {
      if (!actorId) {
        throw new ForbiddenException('Room access verification required');
      }

      const allowed = await this.robotsService.validateRoomAccess({
        robotId,
        actorId,
        roomAccessToken,
      });
      if (!allowed) {
        throw new ForbiddenException('Room access verification required');
      }
    }

    return this.getQueue(robotId);
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

  async vote(robotId: string, targetUserId: string, voterUserId: string, roomAccessToken?: string) {
    if (targetUserId === voterUserId) {
      throw new BadRequestException('You cannot vote for yourself');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { queueMode: true },
    });
    if (!robot) {
      throw new BadRequestException('Robot not found');
    }
    if (robot.queueMode !== 'VOTING') {
      throw new BadRequestException('Voting is not enabled for this queue');
    }

    const allowed = await this.robotsService.validateRoomAccess({
      robotId,
      actorId: voterUserId,
      roomAccessToken,
    });
    if (!allowed) {
      throw new ForbiddenException('Room access verification required');
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
    const voteAllowed = await this.redis.set(cooldownKey, Date.now().toString(), 'EX', 5, 'NX');
    if (voteAllowed !== 'OK') {
      throw new ConflictException('Voting too fast. Please wait a moment.');
    }

    await this.redis.hset(this.voteBallotKey(robotId), voterUserId, targetUserId);
    await this.redis.expire(this.voteBallotKey(robotId), 12 * 60 * 60);
    await this.recomputeQueueVotes(robotId);

    const updated = await this.prisma.queueEntry.findUnique({
      where: { id: entry.id },
    });

    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'vote', userId: targetUserId }));
    return updated;
  }

  async clearQueue(robotId: string) {
    await this.prisma.queueEntry.deleteMany({ where: { robotId } });
    await this.redis.del(this.voteBallotKey(robotId));
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'clear' }));
  }

  async clearAllQueues() {
    await this.prisma.queueEntry.deleteMany();
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

  private voteBallotKey(robotId: string) {
    return `queue:ballots:${robotId}`;
  }

  private async removeVotingFootprint(robotId: string, userId: string) {
    const ballotKey = this.voteBallotKey(robotId);
    const ballots = await this.redis.hgetall(ballotKey);
    if (!Object.keys(ballots).length) {
      return;
    }

    const pipeline = this.redis.pipeline();
    pipeline.hdel(ballotKey, userId);

    for (const [voterUserId, targetUserId] of Object.entries(ballots)) {
      if (targetUserId === userId) {
        pipeline.hdel(ballotKey, voterUserId);
      }
    }

    await pipeline.exec();
  }

  private async recomputeQueueVotes(robotId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { queueMode: true },
    });
    if (!robot || robot.queueMode !== 'VOTING') {
      await this.prisma.queueEntry.updateMany({
        where: { robotId, votes: { not: 0 } },
        data: { votes: 0 },
      });
      await this.redis.del(this.voteBallotKey(robotId));
      return;
    }

    const entries = await this.prisma.queueEntry.findMany({
      where: { robotId },
      select: { id: true, userId: true, votes: true },
    });
    const queuedUserIds = new Set(entries.map((entry) => entry.userId));
    const ballots = await this.redis.hgetall(this.voteBallotKey(robotId));
    const nextVotes = new Map<string, number>();
    const cleanupPipeline = this.redis.pipeline();
    let hasCleanup = false;

    for (const [voterUserId, targetUserId] of Object.entries(ballots)) {
      const valid =
        queuedUserIds.has(voterUserId) &&
        queuedUserIds.has(targetUserId) &&
        voterUserId !== targetUserId;
      if (!valid) {
        cleanupPipeline.hdel(this.voteBallotKey(robotId), voterUserId);
        hasCleanup = true;
        continue;
      }

      nextVotes.set(targetUserId, (nextVotes.get(targetUserId) ?? 0) + 1);
    }

    if (hasCleanup) {
      await cleanupPipeline.exec();
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const voteCount = nextVotes.get(entry.userId) ?? 0;
        if (entry.votes === voteCount) {
          continue;
        }

        await tx.queueEntry.update({
          where: { id: entry.id },
          data: { votes: voteCount },
        });
      }
    });
  }
}
