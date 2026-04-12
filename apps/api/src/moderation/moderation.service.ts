import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ModerateUserDto } from './moderation.dto';
import { ModerationActionType, WS_EVENTS } from '@botparty/shared';
import { LivekitService } from '../livekit/livekit.service';
import { RobotsService, type RobotActionPayload } from '../robots/robots.service';

type ContainerMetricAccumulator = {
  service: string;
  containerName: string | null;
  cpuUsageSeconds: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  rxBytes: number;
  txBytes: number;
};

type CadvisorSample = {
  capturedAt: number;
  machineCpuCores: number | null;
  machineMemoryBytes: number | null;
  hostCpuUsageSeconds: number | null;
  hostMemoryUsageBytes: number | null;
  hostRxBytes: number;
  hostTxBytes: number;
  containers: Map<string, ContainerMetricAccumulator>;
};

const PROFANITY_TERMS = {
  english: [
    'fuck',
    'fucking',
    'motherfucker',
    'motherfucking',
    'shit',
    'bullshit',
    'bitch',
    'asshole',
    'dickhead',
    'douchebag',
    'bastard',
    'cunt',
    'slut',
    'whore',
    'nigger',
    'nigga',
    'fag',
    'faggot',
    'retard',
  ],
  german: [
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
    'scheisse',
    'scheiss',
    'verpiss dich',
  ],
  spanish: [
    'puta',
    'puto',
    'hijo de puta',
    'joder',
    'mierda',
    'gilipollas',
    'cabron',
    'cabrona',
    'pendejo',
    'pendeja',
    'maricon',
    'cojones',
  ],
  french: [
    'putain',
    'pute',
    'fils de pute',
    'merde',
    'connard',
    'connasse',
    'salope',
    'encule',
    'enculer',
    'enfoire',
  ],
  portuguese: [
    'porra',
    'caralho',
    'puta',
    'filho da puta',
    'filha da puta',
    'foder',
    'fodase',
    'merda',
    'arrombado',
    'viado',
  ],
  italian: [
    'cazzo',
    'merda',
    'stronzo',
    'stronza',
    'puttana',
    'troia',
    'vaffanculo',
    'coglione',
    'bastardo',
  ],
  dutch: ['kanker', 'klootzak', 'kut', 'hoer', 'tering', 'tyfus'],
  turkish: ['orospu', 'pic', 'siktir', 'amk', 'yarrak', 'ibne'],
  russian: ['блять', 'блядь', 'сука', 'хуй', 'пизда', 'ебать', 'blyat', 'suka', 'pizda', 'ebat'],
  obfuscated: [
    'fck',
    'phuck',
    'fuk',
    'fuq',
    'sh1t',
    'b1tch',
    'a55hole',
    'n1gga',
    'n1gger',
  ],
} as const;

const PROFANITY_BASE_TERMS = Array.from(
  new Set(Object.values(PROFANITY_TERMS).flatMap((terms) => terms.map((term) => normalizeProfanityText(term)))),
).filter(Boolean);

const SEVERE_COMPACT_TERMS = [
  'fuck',
  'motherfucker',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'hurensohn',
  'arschloch',
  'fotze',
  'gilipollas',
  'hijodeputa',
  'putain',
  'filsdepute',
  'caralho',
  'filhodaputa',
  'vaffanculo',
  'klootzak',
  'orospu',
  'siktir',
  'блять',
  'блядь',
  'пизда',
].map((term) => normalizeCompactProfanityText(term));

const PROFANITY_REGEX = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(${PROFANITY_BASE_TERMS.map((term) => escapeProfanityTerm(term)).join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'giu',
);

const FORBIDDEN_SYMBOL_PATTERNS = [
  /[\u5350\u534D]/u, // Swastika variants: 卐 / 卍
  /ϟ\s*ϟ/iu,
  /ᛋ\s*ᛋ/iu,
];

const FORBIDDEN_HATE_TERMS = [
  'heil hitler',
  'sieg heil',
  'white power',
  'white supremacy',
  '1488',
  '14 words',
  'blood and soil',
  'hakenkreuz',
].map((term) => normalizeProfanityText(term));

const FORBIDDEN_HATE_COMPACT_TERMS = [
  'heilhitler',
  'siegheil',
  'whitepower',
  'whitesupremacy',
  '14words',
  'bloodandsoil',
].map((term) => normalizeCompactProfanityText(term));

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeProfanityTerm(term: string): string {
  return term
    .split(/\s+/)
    .map((part) => escapeRegex(part))
    .join('\\s+');
}

function normalizeProfanityText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/[@4]/g, 'a')
    .replace(/[8]/g, 'b')
    .replace(/[€3]/g, 'e')
    .replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/[7+]/g, 't')
    .replace(/[2]/g, 'z')
    .replace(/[9]/g, 'g')
    .replace(/ph/g, 'f')
    .replace(/[_./\\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompactProfanityText(value: string): string {
  return normalizeProfanityText(value).replace(/[\s_]+/g, '');
}

@Injectable()
export class ModerationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationService.name);
  private previousCadvisorSample: CadvisorSample | null = null;
  private cadvisorWarmupInterval: ReturnType<typeof setInterval> | null = null;
  private cadvisorWarmupInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly livekit: LivekitService,
    private readonly config: ConfigService,
    private readonly robotsService: RobotsService,
  ) {}

  onModuleInit() {
    void this._warmCadvisorSample();
    this.cadvisorWarmupInterval = setInterval(() => {
      void this._warmCadvisorSample();
    }, 15000);
  }

  onModuleDestroy() {
    if (this.cadvisorWarmupInterval) {
      clearInterval(this.cadvisorWarmupInterval);
      this.cadvisorWarmupInterval = null;
    }
  }

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

    const createsActiveRestriction =
      dto.action === ModerationActionType.BAN || dto.action === ModerationActionType.TIMEOUT;

    // Deactivate existing active entries only when replacing a live restriction.
    if (createsActiveRestriction) {
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
      const activeBan = await this.prisma.robotModerationEntry.findFirst({
        where: {
          robotId,
          userId: dto.targetUserId,
          isActive: true,
          action: ModerationActionType.BAN,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeBan) {
        throw new BadRequestException('User is not currently banned');
      }

      await this.prisma.robotModerationEntry.updateMany({
        where: {
          robotId,
          userId: dto.targetUserId,
          isActive: true,
          action: ModerationActionType.BAN,
        },
        data: { isActive: false },
      });
      const targetLabel = this._getTargetLabel(dto.targetUserId, target);
      // Publish unban event for the gateway to react to
      await this.redis.publish(
        `ws:moderation:${robotId}`,
        JSON.stringify({
          event: WS_EVENTS.MOD_UNBAN,
          data: {
            userId: dto.targetUserId,
            robotId,
            username: targetLabel.username,
            displayName: targetLabel.displayName,
          },
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
        isActive: createsActiveRestriction,
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
    const targetLabel = this._getTargetLabel(dto.targetUserId, target);

    await this.redis.publish(
      `ws:moderation:${robotId}`,
      JSON.stringify({
        event: wsEvent,
        data: {
          userId: dto.targetUserId,
          username: targetLabel.displayName ?? targetLabel.username,
          displayName: targetLabel.displayName,
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
        action: { in: ['BAN', 'TIMEOUT'] },
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
    const targetLabel = this._getTargetLabel(dto.targetUserId, null);

    if (dto.action === ModerationActionType.UNBAN) {
      const existing = await this._getGuestRestriction(robotId, dto.targetUserId);
      if (!existing || existing.action !== ModerationActionType.BAN) {
        throw new BadRequestException('User is not currently banned');
      }

      await this.redis.del(key);
      await this.redis.publish(
        `ws:moderation:${robotId}`,
        JSON.stringify({
          event: WS_EVENTS.MOD_UNBAN,
          data: {
            userId: dto.targetUserId,
            robotId,
            username: targetLabel.username,
            displayName: targetLabel.displayName,
          },
        }),
      );
      return { action: 'UNBAN', userId: dto.targetUserId };
    }

    let expiresAtMs: number | null = null;
    let persistsRestriction = false;
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (!dto.durationSec) throw new BadRequestException('durationSec required for TIMEOUT');
      expiresAtMs = Date.now() + dto.durationSec * 1000;
      persistsRestriction = true;
    } else if (dto.action === ModerationActionType.BAN) {
      persistsRestriction = true;
    }

    const payload = {
      robotId,
      userId: dto.targetUserId,
      action: dto.action,
      reason: dto.reason,
      moderatorId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
      isActive: persistsRestriction,
    };

    if (expiresAtMs) {
      const ttlSec = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
      await this.redis.set(key, JSON.stringify(payload), 'EX', ttlSec);
    } else if (dto.action === ModerationActionType.BAN) {
      // Keep bans persistent but not forever to avoid unbounded stale keys.
      await this.redis.set(key, JSON.stringify(payload), 'EX', 60 * 60 * 24 * 30);
    }

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
          username: targetLabel.username,
          displayName: targetLabel.displayName,
          moderatorId,
          reason: dto.reason,
          expiresAt: payload.expiresAt,
          robotId,
        },
      }),
    );

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

  private _getTargetLabel(
    targetUserId: string,
    target: { username: string; displayName: string | null } | null,
  ) {
    if (target) {
      return {
        username: target.username,
        displayName: target.displayName,
      };
    }

    const guestLabel = this._isGuestUserId(targetUserId) ? targetUserId.slice('guest:'.length) : targetUserId;
    return {
      username: `Guest-${guestLabel.slice(0, 6)}`,
      displayName: null,
    };
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
    const normalized = normalizeProfanityText(content);
    if (!normalized) {
      return false;
    }

    PROFANITY_REGEX.lastIndex = 0;
    if (PROFANITY_REGEX.test(normalized)) {
      return true;
    }

    const compact = normalizeCompactProfanityText(content);
    if (!compact) {
      return false;
    }

    return SEVERE_COMPACT_TERMS.some((term) => compact.includes(term));
  }

  containsForbiddenSymbols(content: string): boolean {
    if (FORBIDDEN_SYMBOL_PATTERNS.some((pattern) => pattern.test(content))) {
      return true;
    }

    const normalized = normalizeProfanityText(content);
    if (normalized) {
      if (FORBIDDEN_HATE_TERMS.some((term) => normalized.includes(term))) {
        return true;
      }
    }

    const compact = normalizeCompactProfanityText(content);
    if (!compact) {
      return false;
    }

    return FORBIDDEN_HATE_COMPACT_TERMS.some((term) => compact.includes(term));
  }

  maskProfanity(content: string): string {
    PROFANITY_REGEX.lastIndex = 0;
    const normalized = normalizeProfanityText(content);

    if (!normalized || !PROFANITY_REGEX.test(normalized)) {
      return content;
    }

    return normalized.replace(PROFANITY_REGEX, (full, term: string) => {
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

  async getAdminRuntimeOverview(requesterId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester || !this._isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    const robots = await this.prisma.robot.findMany({
      orderBy: [{ status: 'asc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
      take: 120,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        visibility: true,
        queueMode: true,
        viewerCount: true,
        lastOnlineAt: true,
        createdAt: true,
        owner: { select: { id: true, username: true, displayName: true } },
      },
    });

    const robotIds = robots.map((robot) => robot.id);

    const [queueEntries, activeSessions, heartbeatRaw, telemetryRaw, livekitRuntime, cadvisorRuntime] = await Promise.all([
      robotIds.length === 0
        ? Promise.resolve([])
        : this.prisma.queueEntry.findMany({
            where: { robotId: { in: robotIds } },
            select: {
              robotId: true,
              userId: true,
              position: true,
              votes: true,
              isPriority: true,
              joinedAt: true,
              user: { select: { id: true, username: true, displayName: true } },
            },
          }),
      robotIds.length === 0
        ? Promise.resolve([])
        : this.prisma.session.findMany({
            where: { robotId: { in: robotIds }, status: 'ACTIVE' },
            select: {
              id: true,
              robotId: true,
              startedAt: true,
              user: { select: { id: true, username: true, displayName: true } },
            },
          }),
      robotIds.length === 0 ? Promise.resolve([]) : this.redis.mget(...robotIds.map((id) => `robot:heartbeat:${id}`)),
      robotIds.length === 0
        ? Promise.resolve([])
        : this.redis.mget(...robotIds.map((id) => `robot:telemetry:${id}:latest`)),
      this._getLivekitRuntime(),
      this._getCadvisorRuntime(),
    ]);

    const now = Date.now();

    const heartbeatByRobot = new Map<string, number | null>(
      robotIds.map((robotId, index) => {
        const raw = heartbeatRaw[index];
        const parsed = raw ? Number(raw) : NaN;
        return [robotId, Number.isFinite(parsed) ? parsed : null];
      }),
    );

    const telemetryByRobot = new Map<string, Record<string, unknown> | null>(
      robotIds.map((robotId, index) => {
        const raw = telemetryRaw[index];
        if (!raw) {
          return [robotId, null];
        }

        try {
          return [robotId, JSON.parse(raw) as Record<string, unknown>];
        } catch {
          return [robotId, null];
        }
      }),
    );

    const queueByRobot = new Map<string, typeof queueEntries>();
    for (const entry of queueEntries) {
      const bucket = queueByRobot.get(entry.robotId) ?? [];
      bucket.push(entry);
      queueByRobot.set(entry.robotId, bucket);
    }

    const activeSessionByRobot = new Map(activeSessions.map((session) => [session.robotId, session]));
    const livekitRoomByRobot = new Map(
      livekitRuntime.rooms
        .filter((room) => room.robotId)
        .map((room) => [room.robotId as string, room]),
    );

    const robotRuntime = robots.map((robot) => {
      const telemetry = telemetryByRobot.get(robot.id);
      const heartbeatTs = heartbeatByRobot.get(robot.id);
      const room = livekitRoomByRobot.get(robot.id) ?? null;
      const queue = [...(queueByRobot.get(robot.id) ?? [])].sort((left, right) =>
        this._compareQueueEntries(robot.queueMode, left, right),
      );
      const activeSession = activeSessionByRobot.get(robot.id) ?? null;
      const telemetryTs = this._asNumber(telemetry?.ts);

      return {
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: robot.status,
        visibility: robot.visibility,
        queueMode: robot.queueMode,
        viewerCount: robot.viewerCount,
        owner: robot.owner,
        lastOnlineAt: robot.lastOnlineAt?.toISOString() ?? null,
        heartbeatAgeSec: heartbeatTs ? Math.max(0, Math.floor((now - heartbeatTs) / 1000)) : null,
        telemetryAgeSec: telemetryTs ? Math.max(0, Math.floor((now - telemetryTs) / 1000)) : null,
        queueLength: queue.length,
        queueHead:
          queue[0] ? { id: queue[0].user.id, username: queue[0].user.username, displayName: queue[0].user.displayName } : null,
        activeSession:
          activeSession
            ? {
                id: activeSession.id,
                startedAt: activeSession.startedAt.toISOString(),
                user: activeSession.user,
              }
            : null,
        telemetry: telemetry
          ? {
              ts: telemetryTs,
              clientVersion: this._asString(telemetry.clientVersion),
              gitBranch: this._asString(telemetry.gitBranch),
              gitCommit: this._asString(telemetry.gitCommit),
              gitDirty: Boolean(telemetry.gitDirty),
              pythonVersion: this._asString(telemetry.pythonVersion),
              cpuPercent: this._asNumber(telemetry.cpuPercent),
              memoryPercent: this._asNumber(telemetry.memoryPercent),
              temperatureC: this._asNumber(telemetry.temperatureC),
              uptimeSec: this._asNumber(telemetry.uptimeSec),
              controlConnected: Boolean(telemetry.controlConnected),
              livekitConnected: Boolean(telemetry.livekitConnected),
              commandsReceived: this._asNumber(telemetry.commandsReceived) ?? 0,
              cameraFrames: this._asNumber(telemetry.cameraFrames) ?? 0,
            }
          : null,
        livekit: room,
      };
    });

    const platformRuntime = this._mergePlatformRuntimeWithLivekit(cadvisorRuntime, livekitRuntime);

    const cpuSamples = robotRuntime
      .map((robot) => robot.telemetry?.cpuPercent)
      .filter((value): value is number => typeof value === 'number');
    const memorySamples = robotRuntime
      .map((robot) => robot.telemetry?.memoryPercent)
      .filter((value): value is number => typeof value === 'number');

    return {
      generatedAt: new Date(now).toISOString(),
      summary: {
        totalRobots: robots.length,
        onlineRobots: robots.filter((robot) => robot.status === 'ONLINE').length,
        busyRobots: robots.filter((robot) => robot.status === 'BUSY').length,
        offlineRobots: robots.filter((robot) => robot.status === 'OFFLINE').length,
        maintenanceRobots: robots.filter((robot) => robot.status === 'MAINTENANCE').length,
        totalViewers: robots.reduce((sum, robot) => sum + robot.viewerCount, 0),
        queuedUsers: robotRuntime.reduce((sum, robot) => sum + robot.queueLength, 0),
        activeSessions: activeSessions.length,
        telemetryFreshRobots: robotRuntime.filter((robot) => typeof robot.telemetryAgeSec === 'number' && robot.telemetryAgeSec <= 180)
          .length,
        controlConnectedRobots: robotRuntime.filter((robot) => robot.telemetry?.controlConnected).length,
        livekitConnectedRobots: robotRuntime.filter((robot) => robot.telemetry?.livekitConnected).length,
        avgCpuPercent: cpuSamples.length > 0 ? Number((cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length).toFixed(1)) : null,
        avgMemoryPercent:
          memorySamples.length > 0
            ? Number((memorySamples.reduce((sum, value) => sum + value, 0) / memorySamples.length).toFixed(1))
            : null,
        totalIngressKbps: platformRuntime.containers.reduce((sum, container) => sum + (container.rxKbps ?? 0), 0),
        totalEgressKbps: platformRuntime.containers.reduce((sum, container) => sum + (container.txKbps ?? 0), 0),
      },
      platform: platformRuntime,
      livekit: {
        available: livekitRuntime.error === null,
        error: livekitRuntime.error,
        rooms: livekitRuntime.rooms,
        totals: {
          rooms: livekitRuntime.rooms.length,
          participants: livekitRuntime.rooms.reduce((sum, room) => sum + room.participants, 0),
          publishers: livekitRuntime.rooms.reduce((sum, room) => sum + room.publishers, 0),
          subscribers: livekitRuntime.rooms.reduce((sum, room) => sum + room.subscribers, 0),
          estimatedIngressKbps: livekitRuntime.rooms.reduce((sum, room) => sum + room.estimatedIngressKbps, 0),
        },
      },
      robots: robotRuntime,
    };
  }

  async enqueueStaffRobotAction(
    robotId: string,
    requesterId: string,
    payload: RobotActionPayload,
  ) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });
    if (!requester || !this._isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    return this.robotsService.enqueueActionForRobot(robotId, payload);
  }

  async getAdminRobotRecordingStatus(robotId: string, requesterId: string) {
    await this._assertAdmin(requesterId);

    return {
      ...(await this.livekit.getRoomRecordingStatus(robotId)),
      updatedAt: new Date().toISOString(),
    };
  }

  async startAdminRobotRecording(robotId: string, requesterId: string) {
    await this._assertAdmin(requesterId);

    try {
      return {
        ...(await this.livekit.startRoomRecording(robotId)),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start recording';
      throw new BadRequestException(message);
    }
  }

  async stopAdminRobotRecording(robotId: string, requesterId: string) {
    await this._assertAdmin(requesterId);

    try {
      return {
        ...(await this.livekit.stopRoomRecording(robotId)),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop recording';
      throw new BadRequestException(message);
    }
  }

  async listAdminRecordings(requesterId: string) {
    await this._assertAdmin(requesterId);

    const dir = this._recordingsDir();
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return [] as Array<{
        fileName: string;
        sizeBytes: number;
        modifiedAt: string;
        robotId: string | null;
      }>;
    }

    const files = await Promise.all(
      entries
        .filter((name) => name.endsWith('.mp4'))
        .map(async (fileName) => {
          const fullPath = this._resolveRecordingPath(fileName);
          const fileStat = await stat(fullPath);
          const parsed = this._parseRecordingFileName(fileName);
          return {
            fileName,
            sizeBytes: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
            robotId: parsed.robotId,
            cameraId: parsed.cameraId,
            recordedAt: parsed.recordedAt,
          };
        }),
    );

    return files.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
  }

  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> {
    await this._assertAdmin(requesterId);

    const safeName = basename(fileName);
    if (!safeName.endsWith('.mp4')) {
      throw new BadRequestException('Only .mp4 recordings are supported');
    }

    const fullPath = this._resolveRecordingPath(safeName);
    try {
      await stat(fullPath);
    } catch {
      throw new NotFoundException('Recording not found');
    }

    return new StreamableFile(createReadStream(fullPath), {
      type: 'video/mp4',
      disposition: `inline; filename="${safeName}"`,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async _getLivekitRuntime() {
    try {
      const rooms = await this.livekit.listRooms();
      const robotRooms = rooms.filter((room) => room.name.startsWith('robot-'));
      const mappedRooms = await Promise.all(
        robotRooms.map(async (room) => {
          const participants = await this.livekit.listParticipants(room.name);
          const participantSummaries = participants.map((participant) => ({
            identity: participant.identity,
            name: participant.name,
            isPublisher: participant.isPublisher,
            joinedAt: this._livekitTimestampToIso(participant.joinedAtMs, participant.joinedAt),
            trackCount: participant.tracks.length,
          }));
          const publishers = participants.filter((participant) => participant.isPublisher).length;
          const subscribers = participants.filter((participant) => !participant.identity.startsWith('robot-')).length;

          return {
            roomName: room.name,
            robotId: this._robotIdFromRoomName(room.name),
            sid: room.sid,
            participants: room.numParticipants,
            publishers: room.numPublishers || publishers,
            subscribers,
            activeRecording: room.activeRecording,
            createdAt: this._livekitTimestampToIso(room.creationTimeMs, room.creationTime),
            estimatedIngressKbps: Math.round(
              participants.reduce((sum, participant) => sum + this._estimateParticipantIngressBps(participant), 0) / 1000,
            ),
            participantNames: participantSummaries.map((participant) => participant.name || participant.identity).slice(0, 8),
            participantDetails: participantSummaries,
          };
        }),
      );

      return { error: null, rooms: mappedRooms };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'LiveKit runtime unavailable',
        rooms: [],
      };
    }
  }

  private _mergePlatformRuntimeWithLivekit(
    cadvisorRuntime: Awaited<ReturnType<ModerationService['_getCadvisorRuntime']>>,
    livekitRuntime: Awaited<ReturnType<ModerationService['_getLivekitRuntime']>>,
  ) {
    if (!cadvisorRuntime.containers.length) {
      return cadvisorRuntime;
    }

    const livekitIngressKbps = livekitRuntime.rooms.reduce((sum, room) => sum + room.estimatedIngressKbps, 0);
    if (livekitIngressKbps <= 0) {
      return cadvisorRuntime;
    }

    return {
      ...cadvisorRuntime,
      containers: cadvisorRuntime.containers.map((container) => {
        if (container.service !== 'livekit') {
          return container;
        }

        const hasMeasuredIngress = typeof container.rxKbps === 'number' && container.rxKbps > 0;
        if (hasMeasuredIngress) {
          return container;
        }

        return {
          ...container,
          rxKbps: livekitIngressKbps,
        };
      }),
    };
  }

  private async _getCadvisorRuntime() {
    const cadvisorUrl = this.config.get<string>('CADVISOR_URL')?.trim();
    if (!cadvisorUrl) {
      return {
        available: false,
        error: 'CADVISOR_URL not configured',
        host: null,
        containers: [] as Array<{
          service: string;
          containerName: string | null;
          cpuPercent: number | null;
          memoryUsageBytes: number | null;
          memoryLimitBytes: number | null;
          memoryPercent: number | null;
          rxKbps: number | null;
          txKbps: number | null;
        }>,
      };
    }

    try {
      const response = await fetch(`${cadvisorUrl.replace(/\/$/, '')}/metrics`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        throw new Error(`cAdvisor returned ${response.status}`);
      }

      const text = await response.text();
      const current = this._parseCadvisorMetrics(text);
      const previous = this.previousCadvisorSample;
      this.previousCadvisorSample = current;

      const hostCpuPercent = this._computeCpuPercent(
        current.hostCpuUsageSeconds,
        previous?.hostCpuUsageSeconds ?? null,
        current.capturedAt,
        previous?.capturedAt ?? null,
        current.machineCpuCores,
      );
      const hostRxKbps = this._computeRateKbps(current.hostRxBytes, previous?.hostRxBytes ?? null, current.capturedAt, previous?.capturedAt ?? null);
      const hostTxKbps = this._computeRateKbps(current.hostTxBytes, previous?.hostTxBytes ?? null, current.capturedAt, previous?.capturedAt ?? null);

      const containers = Array.from(current.containers.values())
        .map((container) => {
          const previousContainer = previous?.containers.get(container.service) ?? null;
          const memoryLimitBytes =
            typeof container.memoryLimitBytes === 'number' && container.memoryLimitBytes > 0
              ? container.memoryLimitBytes
              : current.machineMemoryBytes;
          const memoryPercent =
            typeof container.memoryUsageBytes === 'number' && typeof memoryLimitBytes === 'number' && memoryLimitBytes > 0
              ? Number(((container.memoryUsageBytes / memoryLimitBytes) * 100).toFixed(1))
              : null;

          return {
            service: container.service,
            containerName: container.containerName,
            cpuPercent: this._computeCpuPercent(
              container.cpuUsageSeconds,
              previousContainer?.cpuUsageSeconds ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
              current.machineCpuCores,
            ),
            memoryUsageBytes: container.memoryUsageBytes,
            memoryLimitBytes,
            memoryPercent,
            rxKbps: this._computeRateKbps(
              container.rxBytes,
              previousContainer?.rxBytes ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
            ),
            txKbps: this._computeRateKbps(
              container.txBytes,
              previousContainer?.txBytes ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
            ),
          };
        })
        .sort((left, right) => left.service.localeCompare(right.service));

      return {
        available: true,
        error: null,
        host: {
          cpuCores: current.machineCpuCores,
          memoryBytes: current.machineMemoryBytes,
          cpuPercent: hostCpuPercent,
          memoryUsageBytes: current.hostMemoryUsageBytes,
          memoryPercent:
            typeof current.hostMemoryUsageBytes === 'number' && typeof current.machineMemoryBytes === 'number' && current.machineMemoryBytes > 0
              ? Number(((current.hostMemoryUsageBytes / current.machineMemoryBytes) * 100).toFixed(1))
              : null,
          rxKbps: hostRxKbps,
          txKbps: hostTxKbps,
        },
        containers,
      };
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : 'cAdvisor unavailable',
        host: null,
        containers: [],
      };
    }
  }

  private async _warmCadvisorSample() {
    const cadvisorUrl = this.config.get<string>('CADVISOR_URL')?.trim();
    if (!cadvisorUrl || this.cadvisorWarmupInFlight) {
      return;
    }

    this.cadvisorWarmupInFlight = true;
    try {
      await this._getCadvisorRuntime();
    } catch (err) {
      this.logger.debug(`cAdvisor warmup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      this.cadvisorWarmupInFlight = false;
    }
  }

  private _parseCadvisorMetrics(text: string): CadvisorSample {
    const containers = new Map<string, ContainerMetricAccumulator>();
    const sample: CadvisorSample = {
      capturedAt: Date.now(),
      machineCpuCores: null,
      machineMemoryBytes: null,
      hostCpuUsageSeconds: null,
      hostMemoryUsageBytes: null,
      hostRxBytes: 0,
      hostTxBytes: 0,
      containers,
    };

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const parsed = this._parsePrometheusLine(line);
      if (!parsed) {
        continue;
      }

      const { metric, labels, value } = parsed;
      if (metric === 'machine_cpu_cores') {
        sample.machineCpuCores = value;
        continue;
      }
      if (metric === 'machine_memory_bytes') {
        sample.machineMemoryBytes = value;
        continue;
      }

      const id = labels.id ?? labels.name ?? '';
      const containerName = this._normalizeCadvisorContainerName(labels.name?.trim() || labels.container?.trim() || null);
      const service = this._resolveCadvisorService(labels, containerName);
      const interfaceName = labels.interface?.trim();

      if (id === '/') {
        if (metric === 'container_cpu_usage_seconds_total') {
          sample.hostCpuUsageSeconds = value;
        } else if (metric === 'container_memory_working_set_bytes') {
          sample.hostMemoryUsageBytes = value;
        } else if (metric === 'container_network_receive_bytes_total' && interfaceName !== 'lo') {
          sample.hostRxBytes += value;
        } else if (metric === 'container_network_transmit_bytes_total' && interfaceName !== 'lo') {
          sample.hostTxBytes += value;
        }
        continue;
      }

      if (!service) {
        continue;
      }

      const entry = containers.get(service) ?? {
        service,
        containerName,
        cpuUsageSeconds: null,
        memoryUsageBytes: null,
        memoryLimitBytes: null,
        rxBytes: 0,
        txBytes: 0,
      };
      if (!entry.containerName && containerName) {
        entry.containerName = containerName;
      }

      if (metric === 'container_cpu_usage_seconds_total') {
        entry.cpuUsageSeconds = value;
      } else if (metric === 'container_memory_working_set_bytes') {
        entry.memoryUsageBytes = value;
      } else if (metric === 'container_spec_memory_limit_bytes') {
        entry.memoryLimitBytes = value;
      } else if (metric === 'container_network_receive_bytes_total' && interfaceName !== 'lo') {
        entry.rxBytes += value;
      } else if (metric === 'container_network_transmit_bytes_total' && interfaceName !== 'lo') {
        entry.txBytes += value;
      }

      containers.set(service, entry);
    }

    return sample;
  }

  private _parsePrometheusLine(line: string): { metric: string; labels: Record<string, string>; value: number } | null {
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?:\s+[-+]?\d+)?$/,
    );
    if (!match) {
      return null;
    }

    const metric = match[1];
    const labelsRaw = match[3] ?? '';
    const value = Number(match[4]);
    if (!metric || !Number.isFinite(value)) {
      return null;
    }

    const labels: Record<string, string> = {};
    const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;
    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelPattern.exec(labelsRaw)) !== null) {
      const labelKey = labelMatch[1];
      const labelValue = labelMatch[2];
      if (!labelKey || labelValue === undefined) {
        continue;
      }
      labels[labelKey] = labelValue
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    return { metric, labels, value };
  }

  private _normalizeCadvisorContainerName(name: string | null): string | null {
    if (!name) {
      return null;
    }

    const normalized = name.trim().replace(/^\/+/, '');
    return normalized || null;
  }

  private _resolveCadvisorService(labels: Record<string, string>, containerName: string | null) {
    const composeService = labels.container_label_com_docker_compose_service?.trim();
    if (composeService) {
      return composeService;
    }

    if (!containerName) {
      return '';
    }

    if (containerName.startsWith('botparty-')) {
      return containerName.slice('botparty-'.length);
    }

    return containerName;
  }

  private _computeCpuPercent(
    currentValue: number | null,
    previousValue: number | null,
    currentTs: number,
    previousTs: number | null,
    machineCpuCores: number | null,
  ) {
    if (
      typeof currentValue !== 'number' ||
      typeof previousValue !== 'number' ||
      typeof previousTs !== 'number' ||
      typeof machineCpuCores !== 'number' ||
      machineCpuCores <= 0
    ) {
      return null;
    }

    const deltaSeconds = (currentTs - previousTs) / 1000;
    const deltaCpu = currentValue - previousValue;
    if (deltaSeconds <= 0 || deltaCpu < 0) {
      return null;
    }

    return Number(Math.max(0, Math.min(100, (deltaCpu / deltaSeconds / machineCpuCores) * 100)).toFixed(1));
  }

  private _computeRateKbps(
    currentValue: number,
    previousValue: number | null,
    currentTs: number,
    previousTs: number | null,
  ) {
    if (typeof previousValue !== 'number' || typeof previousTs !== 'number') {
      return null;
    }

    const deltaSeconds = (currentTs - previousTs) / 1000;
    const deltaBytes = currentValue - previousValue;
    if (deltaSeconds <= 0 || deltaBytes < 0) {
      return null;
    }

    return Number((((deltaBytes * 8) / 1000) / deltaSeconds).toFixed(1));
  }

  private _robotIdFromRoomName(roomName: string): string | null {
    if (!roomName.startsWith('robot-')) {
      return null;
    }

    const robotId = roomName.slice('robot-'.length).trim();
    return robotId || null;
  }

  private _livekitTimestampToIso(msValue?: bigint, secValue?: bigint): string | null {
    let timestampMs: bigint | null = null;

    if (typeof msValue === 'bigint' && msValue > 0n) {
      timestampMs = msValue;
    } else if (typeof secValue === 'bigint' && secValue > 0n) {
      timestampMs = secValue * 1000n;
    }

    if (timestampMs === null || timestampMs > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }

    return new Date(Number(timestampMs)).toISOString();
  }

  private _estimateParticipantIngressBps(participant: {
    tracks: Array<{
      layers?: Array<{ bitrate: number }>;
      codecs?: Array<{ layers?: Array<{ bitrate: number }> }>;
    }>;
  }): number {
    return participant.tracks.reduce((sum, track) => sum + this._estimateTrackBitrateBps(track), 0);
  }

  private _estimateTrackBitrateBps(track: {
    layers?: Array<{ bitrate: number }>;
    codecs?: Array<{ layers?: Array<{ bitrate: number }> }>;
  }): number {
    let bestBitrate = 0;

    for (const codec of track.codecs ?? []) {
      for (const layer of codec.layers ?? []) {
        if (typeof layer.bitrate === 'number' && Number.isFinite(layer.bitrate)) {
          bestBitrate = Math.max(bestBitrate, layer.bitrate);
        }
      }
    }

    if (bestBitrate > 0) {
      return bestBitrate;
    }

    for (const layer of track.layers ?? []) {
      if (typeof layer.bitrate === 'number' && Number.isFinite(layer.bitrate)) {
        bestBitrate = Math.max(bestBitrate, layer.bitrate);
      }
    }

    return bestBitrate;
  }

  private _compareQueueEntries(
    queueMode: string,
    left: {
      isPriority: boolean;
      votes: number;
      position: number;
      joinedAt: Date;
    },
    right: {
      isPriority: boolean;
      votes: number;
      position: number;
      joinedAt: Date;
    },
  ) {
    if (left.isPriority !== right.isPriority) {
      return left.isPriority ? -1 : 1;
    }

    if (queueMode === 'VOTING' && left.votes !== right.votes) {
      return right.votes - left.votes;
    }

    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.joinedAt.getTime() - right.joinedAt.getTime();
  }

  private _asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private _asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

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

  private async _assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Access denied');
    }
  }

  private _recordingsDir(): string {
    return this.config.get<string>('LIVEKIT_RECORDINGS_DIR')?.trim() || '/recordings';
  }

  private _resolveRecordingPath(fileName: string): string {
    const dir = this._recordingsDir();
    const resolvedDir = resolve(dir);
    const resolvedFile = resolve(join(resolvedDir, fileName));
    if (!resolvedFile.startsWith(`${resolvedDir}/`) && resolvedFile !== resolvedDir) {
      throw new BadRequestException('Invalid recording file path');
    }
    return resolvedFile;
  }

  private _robotIdFromRecordingFileName(fileName: string): string | null {
    return this._parseRecordingFileName(fileName).robotId;
  }

  private _parseRecordingFileName(fileName: string): {
    robotId: string | null;
    cameraId: string | null;
    recordedAt: string | null;
  } {
    const trimmed = basename(fileName).trim();
    const nameWithoutExt = trimmed.replace(/\.mp4$/i, '');
    const strict = nameWithoutExt.match(/^robot-([0-9a-f-]{36})(?:-([a-zA-Z0-9._-]+))?-(\d{4}-\d{2}-\d{2}T\d{6})$/i);
    if (strict) {
      const [, robotId, cameraIdRaw, compactTime] = strict;
      return {
        robotId: robotId ?? null,
        cameraId: cameraIdRaw ? cameraIdRaw.replace(/^camera[-_]?/i, '') : null,
        recordedAt: compactTime ? this._compactRecordingTimeToIso(compactTime) : null,
      };
    }

    const fallbackTimeMatch = nameWithoutExt.match(/(\d{4}-\d{2}-\d{2}T\d{6})(?!.*\d{4}-\d{2}-\d{2}T\d{6})/);
    const cameraMatch = nameWithoutExt.match(/(?:^|[-_])(camera|cam|stream)[-_]?([a-zA-Z0-9._-]+)/i);
    return {
      robotId: nameWithoutExt.match(/robot-([0-9a-f-]{36})/i)?.[1] ?? null,
      cameraId: cameraMatch?.[2] ?? null,
      recordedAt: fallbackTimeMatch?.[1] ? this._compactRecordingTimeToIso(fallbackTimeMatch[1]) : null,
    };
  }

  private _compactRecordingTimeToIso(value: string): string | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private _isStaffRole(role: string): boolean {
    return role === 'ADMIN' || role === 'MOD' || role === 'MODERATOR';
  }
}
