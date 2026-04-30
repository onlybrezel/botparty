import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LIMITS } from '@botparty/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RobotAccessService } from './robot-access.service';
import type { ChatPersistenceService } from './chat-persistence.service';
import type { ChatHistoryMessage, ChatHistoryPage } from './robots.service';

const REALTIME_ROBOT_CACHE_TTL_SEC = 30;
const PUBLIC_OVERVIEW_CACHE_KEY = 'robots:public-overview';

export class RobotRoomStateHelper {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly access: RobotAccessService,
    private readonly chatPersistence: ChatPersistenceService,
  ) {}

  async findByIdCached<T>(robotId: string, loader: () => Promise<T>): Promise<T> {
    const cacheKey = this.realtimeRobotCacheKey(robotId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const robot = await loader();
    await this.redis.set(cacheKey, JSON.stringify(robot), 'EX', REALTIME_ROBOT_CACHE_TTL_SEC);
    return robot;
  }

  async appendChatMessage(robotId: string, userId: string | null | undefined, content: string, timestampMs: number) {
    if (!userId || userId.startsWith('guest:')) {
      return;
    }

    await this.chatPersistence.enqueue({
      robotId,
      userId,
      content,
      timestampMs,
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
    roomAccessToken?: string;
    before?: number;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: input.robotId },
      select: { id: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const access = await this.access.getAccessPolicy(input.robotId);
    if (access.chat === 'DISABLED') {
      throw new ForbiddenException('Chat is disabled for this room');
    }

    const actorId = input.requesterUserId
      ?? this.access.resolveGuestActorId(input.guestSessionId)
      ?? 'guest:chat-history';

    const canAccessRoom = await this.access.validateRoomAccess({
      robotId: input.robotId,
      actorId,
      roomAccessToken: input.roomAccessToken,
    });
    if (!canAccessRoom) {
      throw new ForbiddenException('Room access verification required');
    }

    if (access.chat === 'AUTHENTICATED' && !input.requesterUserId) {
      throw new ForbiddenException('Sign in to read chat history');
    }

    const clampedLimit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const beforeDate =
      typeof input.before === 'number' && Number.isFinite(input.before)
        ? new Date(input.before)
        : null;

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        robotId: input.robotId,
        deletedAt: null,
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: clampedLimit + 1,
      select: {
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
      userId: row.userId,
      username: row.user.username,
      content: row.content,
      timestamp: row.createdAt.getTime(),
    }));

    return {
      messages,
      nextCursor: hasMore && messages.length > 0 ? messages[0]!.timestamp : null,
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
