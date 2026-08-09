import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LIMITS } from '@botparty/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RobotAccessService } from './robot-access.service';
import type { ChatPersistenceService } from './chat-persistence.service';
import type { ChatHistoryMessage, ChatHistoryPage } from './robots.types';
import { parseJsonRecord } from '../common/json-value';
import type { QueueMode } from '@botparty/prisma';

export type RobotRoomStateDatabase = {
  chatMessage: Pick<PrismaService['chatMessage'], 'findMany'>;
  robot: Pick<PrismaService['robot'], 'findUnique' | 'update'>;
};

const REALTIME_ROBOT_CACHE_TTL_SEC = 30;
const PUBLIC_OVERVIEW_CACHE_KEY = 'robots:public-overview';

const REALTIME_QUEUE_MODES: ReadonlySet<string> = new Set<QueueMode>([
  'FIRST_COME',
  'VOTING',
  'DISABLED',
]);

function isQueueMode(value: string): value is QueueMode {
  return REALTIME_QUEUE_MODES.has(value);
}

export interface RealtimeRobotRecord {
  id: string;
  name: string;
  ownerId: string;
  queueMode: QueueMode;
}

function decodeRealtimeRobot(raw: string): RealtimeRobotRecord | null {
  const record = parseJsonRecord(raw);
  if (!record) return null;

  const id = record['id'];
  const name = record['name'];
  const ownerId = record['ownerId'];
  const queueMode = record['queueMode'];
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof name !== 'string' ||
    name.length === 0 ||
    typeof ownerId !== 'string' ||
    ownerId.length === 0 ||
    typeof queueMode !== 'string' ||
    !isQueueMode(queueMode)
  ) {
    return null;
  }

  return { id, name, ownerId, queueMode };
}

export class RobotRoomStateHelper {
  constructor(
    private readonly prisma: RobotRoomStateDatabase,
    private readonly redis: Pick<RedisService, 'del' | 'get' | 'set'>,
    private readonly access: Pick<
      RobotAccessService,
      'getAccessPolicy' | 'resolveGuestActorId' | 'validateRoomAccess'
    >,
    private readonly chatPersistence: Pick<ChatPersistenceService, 'enqueue'>,
  ) {}

  async findByIdCached(
    robotId: string,
    loader: () => Promise<RealtimeRobotRecord>,
  ): Promise<RealtimeRobotRecord> {
    const cacheKey = this.realtimeRobotCacheKey(robotId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const robot = decodeRealtimeRobot(cached);
      if (robot) return robot;
      await this.redis.del(cacheKey);
    }

    const robot = await loader();
    await this.redis.set(cacheKey, JSON.stringify(robot), 'EX', REALTIME_ROBOT_CACHE_TTL_SEC);
    return robot;
  }

  async invalidateRealtimeRobot(robotId: string): Promise<void> {
    await this.redis.del(this.realtimeRobotCacheKey(robotId));
  }

  async appendChatMessage(
    robotId: string,
    userId: string | null | undefined,
    content: string,
    timestampMs: number,
    clientMessageId: string,
  ) {
    if (!userId || userId.startsWith('guest:')) {
      return;
    }

    await this.chatPersistence.enqueue({
      robotId,
      userId,
      content,
      timestampMs,
      clientMessageId,
    });
  }

  async getRecentChatMessages(robotId: string, limit?: number): Promise<ChatHistoryMessage[]> {
    const effectiveLimit = limit ?? LIMITS.CHAT_HISTORY_ON_JOIN;
    const clampedLimit = Math.min(Math.max(effectiveLimit, 1), 200);
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        robotId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: clampedLimit,
      select: {
        id: true,
        userId: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    return rows.reverse().map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      content: row.content,
      timestamp: row.createdAt.getTime(),
    }));
  }

  async getChatHistoryPage(input: {
    robotId: string;
    requesterUserId: string | null;
    guestSessionId?: string;
    roomAccessToken?: string | undefined;
    before?: number;
    beforeId?: string;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: input.robotId },
      select: { id: true, visibility: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const actorId =
      input.requesterUserId ??
      this.access.resolveGuestActorId(input.guestSessionId) ??
      'guest:chat-history';

    const canAccessRoom = await this.access.validateRoomAccess({
      robotId: input.robotId,
      actorId,
      roomAccessToken: input.roomAccessToken,
    });
    if (!canAccessRoom) {
      if (robot.visibility === 'PRIVATE') {
        throw new NotFoundException('Robot not found');
      }
      throw new ForbiddenException('Room access verification required');
    }

    const access = await this.access.getAccessPolicy(input.robotId);
    if (access.chat === 'DISABLED') {
      throw new ForbiddenException('Chat is disabled for this room');
    }

    if (access.chat === 'AUTHENTICATED' && !input.requesterUserId) {
      throw new ForbiddenException('Sign in to read chat history');
    }

    const clampedLimit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const beforeDate =
      typeof input.before === 'number' && Number.isFinite(input.before)
        ? new Date(input.before)
        : null;
    const beforeId =
      typeof input.beforeId === 'string' && input.beforeId.length > 0 ? input.beforeId : null;

    // Stable cursor on (createdAt desc, id desc): when beforeId is provided
    // along with the timestamp, fetch strictly older rows including ties on
    // the millisecond boundary that still sort earlier by id.
    const cursorWhere = beforeDate
      ? beforeId
        ? {
            OR: [
              { createdAt: { lt: beforeDate } },
              { AND: [{ createdAt: beforeDate }, { id: { lt: beforeId } }] },
            ],
          }
        : { createdAt: { lt: beforeDate } }
      : {};

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        robotId: input.robotId,
        deletedAt: null,
        ...cursorWhere,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: clampedLimit + 1,
      select: {
        id: true,
        userId: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    const hasMore = rows.length > clampedLimit;
    const pageRows = hasMore ? rows.slice(0, clampedLimit) : rows;
    const messages = pageRows.reverse().map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      content: row.content,
      timestamp: row.createdAt.getTime(),
    }));

    const oldest = messages[0] ?? null;
    return {
      messages,
      nextCursor: hasMore && oldest ? oldest.timestamp : null,
      nextCursorId: hasMore && oldest ? oldest.id : null,
      hasMore,
    };
  }

  async setViewerCount(robotId: string, viewerCount: number) {
    await this.prisma.robot.update({
      where: { id: robotId },
      data: {
        viewerCount: Math.max(0, viewerCount),
      },
      select: { id: true },
    });
  }

  async invalidatePublicOverviewCache() {
    await this.redis.del(PUBLIC_OVERVIEW_CACHE_KEY);
  }

  private realtimeRobotCacheKey(robotId: string): string {
    return `robot:realtime:${robotId}`;
  }
}
