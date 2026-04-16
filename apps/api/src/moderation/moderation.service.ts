import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ModerateUserDto } from './moderation.dto';
import { ModerationActionType, WS_EVENTS } from '@botparty/shared';
import { LivekitService } from '../livekit/livekit.service';
import { RobotsService, type RobotActionPayload } from '../robots/robots.service';
import { RecordingAdminService } from './recording-admin.service';
import { RuntimeTelemetryService } from './runtime-telemetry.service';
import { isStaffRole, assertStaffOrRobotOwner } from '../common/robot-access';

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
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private static readonly ACTION_COOLDOWN_SEC = 4;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly livekit: LivekitService,
    private readonly config: ConfigService,
    private readonly robotsService: RobotsService,
    private readonly recordingAdmin: RecordingAdminService,
    private readonly runtimeTelemetry: RuntimeTelemetryService,
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

    await this._assertActionNotCoolingDown(robotId, dto.targetUserId, dto.action, moderatorId);

    const activeRestriction = await this.getActiveRestriction(robotId, dto.targetUserId);
    if (dto.action === ModerationActionType.BAN && activeRestriction?.action === ModerationActionType.BAN) {
      throw new ConflictException('User is already banned');
    }
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (activeRestriction?.action === ModerationActionType.BAN) {
        throw new ConflictException('User is already banned');
      }
      if (activeRestriction?.action === ModerationActionType.TIMEOUT) {
        throw new ConflictException('User is already timed out');
      }
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
    await this._assertActionNotCoolingDown(robotId, dto.targetUserId, dto.action, moderatorId);

    const existing = await this._getGuestRestriction(robotId, dto.targetUserId);
    if (dto.action === ModerationActionType.BAN && existing?.action === ModerationActionType.BAN) {
      throw new ConflictException('User is already banned');
    }
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (existing?.action === ModerationActionType.BAN) {
        throw new ConflictException('User is already banned');
      }
      if (existing?.action === ModerationActionType.TIMEOUT) {
        throw new ConflictException('User is already timed out');
      }
    }

    if (dto.action === ModerationActionType.UNBAN) {
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

  private moderationCooldownKey(robotId: string, targetUserId: string, action: ModerationActionType) {
    return `moderation:cooldown:${robotId}:${targetUserId}:${action}`;
  }

  private async _assertActionNotCoolingDown(
    robotId: string,
    targetUserId: string,
    action: ModerationActionType,
    moderatorId: string,
  ) {
    if (action === ModerationActionType.WARN) {
      return;
    }

    const key = this.moderationCooldownKey(robotId, targetUserId, action);
    const payload = JSON.stringify({
      moderatorId,
      createdAt: Date.now(),
    });
    const acquired = await this.redis.set(
      key,
      payload,
      'EX',
      ModerationService.ACTION_COOLDOWN_SEC,
      'NX',
    );
    if (acquired !== 'OK') {
      throw new BadRequestException('That moderation action is cooling down');
    }
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
          thumbnailUrl: true,
          visibility: true,
          accessMode: true,
          queueMode: true,
          maxTurnTime: true,
          maxViewers: true,
          maxControllers: true,
          metadata: true,
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
    return this.runtimeTelemetry.getAdminRuntimeOverview(requesterId);
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
    if (!requester || !isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }
    return this.robotsService.enqueueActionForRobot(robotId, payload);
  }

  async getAdminRobotRecordingStatus(robotId: string, requesterId: string) {
    return this.recordingAdmin.getAdminRobotRecordingStatus(robotId, requesterId);
  }

  async startAdminRobotRecording(robotId: string, requesterId: string) {
    return this.recordingAdmin.startAdminRobotRecording(robotId, requesterId);
  }

  async stopAdminRobotRecording(robotId: string, requesterId: string) {
    return this.recordingAdmin.stopAdminRobotRecording(robotId, requesterId);
  }

  async listAdminRecordings(requesterId: string) {
    return this.recordingAdmin.listAdminRecordings(requesterId);
  }

  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> {
    return this.recordingAdmin.streamAdminRecording(fileName, requesterId);
  }

  private async _assertStaffOrOwner(robotId: string, userId: string) {
    const [robot, user] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    assertStaffOrRobotOwner(robot, user);
  }

  private _isStaffRole(role: string): boolean {
    return isStaffRole(role);
  }
}
