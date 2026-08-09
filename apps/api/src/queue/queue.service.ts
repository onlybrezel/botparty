import {
  Injectable,
  ConflictException,
  ForbiddenException,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RobotsService } from '../robots/robots.service';
import { Prisma } from '@botparty/prisma';
import { readNonNegativeIntegerEnv } from '../common/config-number';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly maxActiveQueueEntriesPerUser: number;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: {
      $transaction<T>(
        callback: (transaction: Pick<Prisma.TransactionClient, '$executeRaw' | 'queueEntry' | 'robot'>) => Promise<T>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ): Promise<T>;
      queueEntry: Pick<
        PrismaService['queueEntry'],
        'aggregate' | 'count' | 'create' | 'delete' | 'deleteMany' | 'findFirst' | 'findMany' | 'findUnique' | 'update' | 'updateMany'
      >;
      robot: Pick<PrismaService['robot'], 'findUnique'>;
    },
    @Inject(RedisService)
    private readonly redis: Pick<RedisService, 'del' | 'eval' | 'expire' | 'hgetall' | 'hset' | 'publish' | 'set'>,
    @Inject(RobotsService)
    private readonly robotsService: Pick<
      RobotsService,
      'findById' | 'getAccessPolicy' | 'resolveGuestActorId' | 'validateRoomAccess'
    >,
    @Inject(ConfigService) private readonly config: Pick<ConfigService, 'get'>,
  ) {
    this.maxActiveQueueEntriesPerUser = readNonNegativeIntegerEnv(
      this.config,
      'MAX_ACTIVE_QUEUE_ENTRIES_PER_USER',
      5,
    );
  }

  async join(robotId: string, userId: string, roomAccessToken?: string, isPriority = false) {
    const robot = await this.robotsService.findById(robotId);
    const allowed = await this.robotsService.validateRoomAccess({
      robotId,
      actorId: userId,
      roomAccessToken,
    });
    if (!allowed) {
      this.throwRoomAccessDenied(robot.visibility);
    }

    const access = await this.robotsService.getAccessPolicy(robotId);
    if (access.control === 'DISABLED') {
      throw new ForbiddenException('Control is disabled for this robot');
    }
    if (robot.status === 'OFFLINE' || robot.status === 'MAINTENANCE') {
      throw new ForbiddenException('This robot is currently offline');
    }

    const entry = await this.withSerializableRetry(() => this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT id FROM robots WHERE id = ${robotId}::uuid FOR UPDATE`;
        if (this.maxActiveQueueEntriesPerUser > 0) {
          await tx.$executeRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          const existingEntries = await tx.queueEntry.count({ where: { userId } });
          if (existingEntries >= this.maxActiveQueueEntriesPerUser) {
            throw new BadRequestException(
              `Maximum of ${this.maxActiveQueueEntriesPerUser} active queue entries allowed per user`,
            );
          }
        }
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
    ));

    await this.removeVotingFootprint(robotId, userId);

    // Publish queue update via Redis for real-time sync
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'join', entry }));

    this.logger.log(`User ${userId} joined queue for robot ${robotId} at position ${entry.position}`);
    return entry;
  }

  async leave(robotId: string, userId: string) {
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

        return { removed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!result.removed) {
      return result;
    }

    await this.removeVotingFootprint(robotId, userId);

    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'leave', userId }));
    return result;
  }

  async getQueue(robotId: string) {
    const orderBy = await this.getQueueOrderBy(robotId);
    const entries = await this.prisma.queueEntry.findMany({
      where: { robotId },
      orderBy,
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId }, select: { queueMode: true } });
    if (robot?.queueMode === 'VOTING') {
      const ballots = await this.redis.hgetall(this.voteBallotKey(robotId));
      const queued = new Set(entries.map((entry) => entry.userId));
      const votes = new Map<string, number>();
      for (const [voter, target] of Object.entries(ballots)) {
        if (voter !== target && queued.has(voter) && queued.has(target)) {
          votes.set(target, (votes.get(target) ?? 0) + 1);
        }
      }
      entries.sort((left, right) =>
        Number(right.isPriority) - Number(left.isPriority)
        || (votes.get(right.userId) ?? 0) - (votes.get(left.userId) ?? 0)
        || left.joinedAt.getTime() - right.joinedAt.getTime(),
      );
      return entries.map((entry, index) => ({ ...entry, votes: votes.get(entry.userId) ?? 0, position: index + 1 }));
    }
    return entries.map((entry, index) => ({ ...entry, position: index + 1 }));
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
        this.throwRoomAccessDenied(robot.visibility);
      }

      const allowed = await this.robotsService.validateRoomAccess({
        robotId,
        actorId,
        roomAccessToken,
      });
      if (!allowed) {
        this.throwRoomAccessDenied(robot.visibility);
      }
    }

    return this.getQueue(robotId);
  }

  async getNextInQueue(robotId: string) {
    return (await this.getQueue(robotId))[0] ?? null;
  }

  async getCurrentControllerUserId(robotId: string): Promise<string | null> {
    const next = await this.getNextInQueue(robotId);
    return next?.userId ?? null;
  }

  async vote(robotId: string, targetUserId: string, voterUserId: string, roomAccessToken?: string) {
    if (targetUserId === voterUserId) {
      throw new BadRequestException('You cannot vote for yourself');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { queueMode: true, visibility: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
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
      this.throwRoomAccessDenied(robot.visibility);
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

    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'vote', userId: targetUserId }));
    return (await this.getQueue(robotId)).find((item) => item.id === entry.id) ?? null;
  }

  async clearQueue(robotId: string) {
    await this.prisma.queueEntry.deleteMany({ where: { robotId } });
    await this.redis.del(this.voteBallotKey(robotId));
    await this.redis.publish(`queue:${robotId}`, JSON.stringify({ type: 'clear' }));
  }

  async clearAllQueues() {
    await this.prisma.queueEntry.deleteMany();
  }

  async listQueuedRobotIds(): Promise<string[]> {
    const rows = await this.prisma.queueEntry.findMany({
      distinct: ['robotId'],
      select: { robotId: true },
    });
    return rows.map((row) => row.robotId);
  }

  private async getQueueOrderBy(_robotId: string): Promise<Prisma.QueueEntryOrderByWithRelationInput[]> {
    return [{ isPriority: 'desc' }, { position: 'asc' }, { joinedAt: 'asc' }];
  }

  private voteBallotKey(robotId: string) {
    return `queue:ballots:${robotId}`;
  }

  private throwRoomAccessDenied(visibility: string): never {
    if (visibility === 'PRIVATE') {
      throw new NotFoundException('Robot not found');
    }
    throw new ForbiddenException('Room access verification required');
  }

  private async removeVotingFootprint(robotId: string, userId: string) {
    const ballotKey = this.voteBallotKey(robotId);
    await this.redis.eval(
      `
        local entries = redis.call('HGETALL', KEYS[1])
        redis.call('HDEL', KEYS[1], ARGV[1])
        for index = 1, #entries, 2 do
          if entries[index + 1] == ARGV[1] then
            redis.call('HDEL', KEYS[1], entries[index])
          end
        end
        return 1
      `,
      1,
      ballotKey,
      userId,
    );
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 8) {
          throw error;
        }
        const backoffMs = Math.min(250, 5 * 2 ** attempt) + Math.floor(Math.random() * 10);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
}
