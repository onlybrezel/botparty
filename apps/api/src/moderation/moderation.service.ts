import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ModerateUserDto } from './moderation.dto';
import { ModerationActionType, WS_EVENTS } from '@botparty/shared';

const PROFANITY_TERMS = [
  // English
  'fuck',
  'fucking',
  'shit',
  'bitch',
  'asshole',
  'motherfucker',
  'cunt',
  'bastard',
  'nigger',
  'nigga',
  'fag',
  'faggot',
  'retard',
  // German
  'hurensohn',
  'hure',
  'fotze',
  'fick',
  'ficken',
  'wichser',
  'arschloch',
  'missgeburt',
  'spast',
  'schlampe',
  'schwuchtel',
  'kanake',
  // Common obfuscated forms
  'fck',
  'f*ck',
  'sh1t',
  'b1tch',
];

const PROFANITY_REGEX = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(${PROFANITY_TERMS
    .map((term) => term.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&'))
    .join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'giu',
);

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Apply a moderation action to a user within a robot's room.
   * The caller must be the robot owner OR a site moderator/admin.
   */
  async moderate(robotId: string, dto: ModerateUserDto, moderatorId: string) {
    const isGuestTarget = this._isGuestUserId(dto.targetUserId);
    const [robot, moderator, target] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: moderatorId } }),
      isGuestTarget ? Promise.resolve(null) : this.prisma.user.findUnique({ where: { id: dto.targetUserId } }),
    ]);

    if (!robot) throw new NotFoundException('Robot not found');
    if (!moderator) throw new NotFoundException('Moderator not found');
    if (!isGuestTarget && !target) throw new NotFoundException('Target user not found');

    const isSiteStaff = this._isStaffRole(moderator.role);
    if (robot.ownerId !== moderatorId && !isSiteStaff) {
      throw new ForbiddenException('Only the robot owner or site staff can moderate');
    }

    // Prevent moderating site admins
    if (!isGuestTarget && target && target.role === 'ADMIN' && !isSiteStaff) {
      throw new ForbiddenException('Cannot moderate a site admin');
    }

    if (isGuestTarget) {
      return this._moderateGuest(robotId, dto, moderatorId);
    }

    // Deactivate existing active entries for same robot+user (we replace them)
    if (dto.action !== ModerationActionType.UNBAN) {
      await this.prisma.robotModerationEntry.updateMany({
        where: { robotId, userId: dto.targetUserId, isActive: true },
        data: { isActive: false },
      });
    }

    let expiresAt: Date | null = null;

    if (dto.action === ModerationActionType.TIMEOUT) {
      if (!dto.durationSec) throw new BadRequestException('durationSec required for TIMEOUT');
      expiresAt = new Date(Date.now() + dto.durationSec * 1000);
    }

    if (dto.action === ModerationActionType.UNBAN) {
      await this.prisma.robotModerationEntry.updateMany({
        where: { robotId, userId: dto.targetUserId, isActive: true },
        data: { isActive: false },
      });
      // Publish unban event for the gateway to react to
      await this.redis.publish(
        `ws:moderation:${robotId}`,
        JSON.stringify({
          event: WS_EVENTS.MOD_UNBAN,
          data: { userId: dto.targetUserId, robotId },
        }),
      );
      return { action: 'UNBAN', userId: dto.targetUserId };
    }

    const entry = await this.prisma.robotModerationEntry.create({
      data: {
        robotId,
        userId: dto.targetUserId,
        action: dto.action,
        reason: dto.reason,
        expiresAt,
        isActive: true,
        moderatorId,
      },
    });

    // Publish to Redis so the gateway can enforce and notify the room
    const wsEvent =
      dto.action === ModerationActionType.BAN
        ? WS_EVENTS.MOD_BAN
        : dto.action === ModerationActionType.KICK
          ? WS_EVENTS.MOD_KICK
          : WS_EVENTS.MOD_TIMEOUT;

    await this.redis.publish(
      `ws:moderation:${robotId}`,
      JSON.stringify({
        event: wsEvent,
        data: {
          userId: dto.targetUserId,
          moderatorId,
          reason: dto.reason,
          expiresAt,
          robotId,
        },
      }),
    );

    return entry;
  }

  /** Check whether a user is currently banned or timed-out in a robot room. */
  async getActiveRestriction(robotId: string, userId: string) {
    if (this._isGuestUserId(userId)) {
      return this._getGuestRestriction(robotId, userId);
    }

    const entry = await this.prisma.robotModerationEntry.findFirst({
      where: {
        robotId,
        userId,
        isActive: true,
        action: { in: ['BAN', 'TIMEOUT', 'KICK'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    // Expire timed-out entries lazily
    if (entry && entry.expiresAt && entry.expiresAt <= new Date()) {
      await this.prisma.robotModerationEntry.update({
        where: { id: entry.id },
        data: { isActive: false },
      });
      return null;
    }

    return entry;
  }

  private async _moderateGuest(robotId: string, dto: ModerateUserDto, moderatorId: string) {
    const key = this._guestRestrictionKey(robotId, dto.targetUserId);

    if (dto.action === ModerationActionType.UNBAN) {
      await this.redis.del(key);
      return { action: 'UNBAN', userId: dto.targetUserId };
    }

    let expiresAtMs: number | null = null;
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (!dto.durationSec) throw new BadRequestException('durationSec required for TIMEOUT');
      expiresAtMs = Date.now() + dto.durationSec * 1000;
    }

    const payload = {
      robotId,
      userId: dto.targetUserId,
      action: dto.action,
      reason: dto.reason,
      moderatorId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
      isActive: true,
    };

    if (expiresAtMs) {
      const ttlSec = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
      await this.redis.set(key, JSON.stringify(payload), 'EX', ttlSec);
    } else {
      // Keep bans persistent but not forever to avoid unbounded stale keys.
      await this.redis.set(key, JSON.stringify(payload), 'EX', 60 * 60 * 24 * 30);
    }

    return payload;
  }

  private async _getGuestRestriction(robotId: string, userId: string) {
    const raw = await this.redis.get(this._guestRestrictionKey(robotId, userId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as {
        action?: string;
        expiresAt?: string | null;
        [key: string]: unknown;
      };

      if (parsed.expiresAt) {
        const exp = Date.parse(parsed.expiresAt);
        if (Number.isFinite(exp) && exp <= Date.now()) {
          await this.redis.del(this._guestRestrictionKey(robotId, userId));
          return null;
        }
      }

      return parsed;
    } catch {
      await this.redis.del(this._guestRestrictionKey(robotId, userId));
      return null;
    }
  }

  private _isGuestUserId(userId: string): boolean {
    return userId.startsWith('guest:');
  }

  private _guestRestrictionKey(robotId: string, userId: string): string {
    return `moderation:guest:restriction:${robotId}:${userId}`;
  }

  sanitizeChatContent(raw: string): { sanitized: string; hasIllegalChars: boolean } {
    const normalized = raw.normalize('NFKC');
    // Remove control/non-printable chars and collapse whitespace.
    const cleaned = normalized
      .replace(/[\u0000-\u001F\u007F\u0080-\u009F]/g, ' ') // eslint-disable-line no-control-regex
      .replace(/\s+/g, ' ')
      .trim();

    return {
      sanitized: cleaned,
      hasIllegalChars: cleaned !== normalized.trim(),
    };
  }

  containsProfanity(content: string): boolean {
    PROFANITY_REGEX.lastIndex = 0;
    return PROFANITY_REGEX.test(content);
  }

  maskProfanity(content: string): string {
    PROFANITY_REGEX.lastIndex = 0;
    return content.replace(PROFANITY_REGEX, (full, term: string) => {
      const replacement = `${term[0] ?? '*'}${'*'.repeat(Math.max(term.length - 1, 1))}`;
      return full.replace(term, replacement);
    });
  }

  async recordProfanityEvent(input: {
    robotId: string;
    userId: string;
    username: string;
    content: string;
  }) {
    const totalKey = `moderation:profanity:robot:${input.robotId}:total`;
    const byUserKey = `moderation:profanity:robot:${input.robotId}:by-user`;
    const listKey = `moderation:profanity:robot:${input.robotId}:events`;

    const event = {
      ts: Date.now(),
      userId: input.userId,
      username: input.username,
      content: input.content.slice(0, 400),
    };

    const pipeline = this.redis.pipeline();
    pipeline.incr(totalKey);
    pipeline.hincrby(byUserKey, input.userId, 1);
    pipeline.lpush(listKey, JSON.stringify(event));
    pipeline.ltrim(listKey, 0, 199);
    pipeline.expire(totalKey, 60 * 60 * 24 * 30);
    pipeline.expire(byUserKey, 60 * 60 * 24 * 30);
    pipeline.expire(listKey, 60 * 60 * 24 * 30);
    await pipeline.exec();
  }

  async getProfanityOverview(requesterId: string, robotId: string) {
    await this._assertStaffOrOwner(robotId, requesterId);

    const totalKey = `moderation:profanity:robot:${robotId}:total`;
    const byUserKey = `moderation:profanity:robot:${robotId}:by-user`;
    const listKey = `moderation:profanity:robot:${robotId}:events`;

    const [totalRaw, byUserRaw, eventsRaw] = await Promise.all([
      this.redis.get(totalKey),
      this.redis.hgetall(byUserKey),
      this.redis.lrange(listKey, 0, 99),
    ]);

    const events = eventsRaw
      .map((row) => {
        try {
          return JSON.parse(row) as {
            ts: number;
            userId: string;
            username: string;
            content: string;
          };
        } catch {
          return null;
        }
      })
      .filter((row): row is { ts: number; userId: string; username: string; content: string } => row !== null);

    return {
      total: totalRaw ? Number(totalRaw) : 0,
      byUser: Object.entries(byUserRaw)
        .map(([userId, count]) => ({ userId, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count),
      events,
    };
  }

  async getGlobalProfanityOverview(requesterId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester || !this._isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    const robots = await this.prisma.robot.findMany({
      orderBy: { createdAt: 'desc' },
      take: 250,
      select: { id: true, name: true, slug: true },
    });

    const robotMetrics = await Promise.all(
      robots.map(async (robot) => {
        const totalKey = `moderation:profanity:robot:${robot.id}:total`;
        const byUserKey = `moderation:profanity:robot:${robot.id}:by-user`;
        const listKey = `moderation:profanity:robot:${robot.id}:events`;

        const [totalRaw, byUserRaw, eventsRaw] = await Promise.all([
          this.redis.get(totalKey),
          this.redis.hgetall(byUserKey),
          this.redis.lrange(listKey, 0, 20),
        ]);

        const events = eventsRaw
          .map((row) => {
            try {
              const parsed = JSON.parse(row) as {
                ts: number;
                userId: string;
                username: string;
                content: string;
              };
              return {
                ...parsed,
                robotId: robot.id,
                robotName: robot.name,
                robotSlug: robot.slug,
              };
            } catch {
              return null;
            }
          })
          .filter(
            (
              row,
            ): row is {
              ts: number;
              userId: string;
              username: string;
              content: string;
              robotId: string;
              robotName: string;
              robotSlug: string;
            } => row !== null,
          );

        return {
          robot,
          total: totalRaw ? Number(totalRaw) : 0,
          byUserRaw,
          events,
        };
      }),
    );

    const userCounts = new Map<string, number>();
    const robotCounts = robotMetrics
      .map((entry) => ({
        robotId: entry.robot.id,
        robotName: entry.robot.name,
        robotSlug: entry.robot.slug,
        count: entry.total,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);

    for (const entry of robotMetrics) {
      for (const [userId, rawCount] of Object.entries(entry.byUserRaw)) {
        const current = userCounts.get(userId) ?? 0;
        userCounts.set(userId, current + (Number(rawCount) || 0));
      }
    }

    const events = robotMetrics
      .flatMap((entry) => entry.events)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 150);

    return {
      total: robotCounts.reduce((sum, entry) => sum + entry.count, 0),
      byUser: Array.from(userCounts.entries())
        .map(([userId, count]) => ({ userId, count }))
        .sort((a, b) => b.count - a.count),
      byRobot: robotCounts,
      events,
    };
  }

  /** Get moderation log for a robot (owner / site staff only). */
  async getLog(robotId: string, requesterId: string) {
    await this._assertStaffOrOwner(robotId, requesterId);
    return this.prisma.robotModerationEntry.findMany({
      where: { robotId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, username: true, displayName: true } },
        moderator: { select: { id: true, username: true } },
      },
    });
  }

  async getAdminOverview(requesterId: string, robotId?: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester || !this._isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    const activeWhere = {
      isActive: true,
      ...(robotId ? { robotId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    const [recentActions, activeRestrictions, robots] = await Promise.all([
      this.prisma.robotModerationEntry.findMany({
        where: robotId ? { robotId } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 150,
        include: {
          robot: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, username: true, displayName: true } },
          moderator: { select: { id: true, username: true } },
        },
      }),
      this.prisma.robotModerationEntry.findMany({
        where: activeWhere,
        orderBy: { createdAt: 'desc' },
        take: 150,
        include: {
          robot: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, username: true, displayName: true } },
          moderator: { select: { id: true, username: true } },
        },
      }),
      this.prisma.robot.findMany({
        where: robotId ? { id: robotId } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          description: true,
          visibility: true,
          tags: true,
          owner: { select: { id: true, username: true, displayName: true } },
        },
      }),
    ]);

    return {
      recentActions,
      activeRestrictions,
      robots,
      counts: {
        bans: activeRestrictions.filter((entry: { action: string }) => entry.action === 'BAN').length,
        timeouts: activeRestrictions.filter((entry: { action: string }) => entry.action === 'TIMEOUT').length,
        kicks: activeRestrictions.filter((entry: { action: string }) => entry.action === 'KICK').length,
      },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async _assertStaffOrOwner(robotId: string, userId: string) {
    const [robot, user] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!robot) throw new NotFoundException('Robot not found');
    if (!user) throw new NotFoundException('User not found');
    const isStaff = this._isStaffRole(user.role);
    if (robot.ownerId !== userId && !isStaff) {
      throw new ForbiddenException('Access denied');
    }
  }

  private _isStaffRole(role: string): boolean {
    return role === 'ADMIN' || role === 'MOD' || role === 'MODERATOR';
  }
}
