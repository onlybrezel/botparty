import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { assertStaffOrRobotOwner, isStaffRole } from '../common/robot-access';
import { parseJsonRecord } from '../common/json-value';

type ProfanityEvent = { ts: number; userId: string; username: string; content: string };

function parseProfanityEvent(raw: string): ProfanityEvent | null {
  const parsed = parseJsonRecord(raw);
  if (
    !parsed ||
    typeof parsed['ts'] !== 'number' ||
    typeof parsed['userId'] !== 'string' ||
    typeof parsed['username'] !== 'string' ||
    typeof parsed['content'] !== 'string'
  ) {
    return null;
  }
  return {
    ts: parsed['ts'],
    userId: parsed['userId'],
    username: parsed['username'],
    content: parsed['content'],
  };
}

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
  /[\u5350\u534D]/u,
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

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? ' '
      : character;
  }).join('');
}

@Injectable()
export class ModerationAuditService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: {
      robot: Pick<PrismaService['robot'], 'findMany' | 'findUnique'>;
      robotModerationEntry: Pick<PrismaService['robotModerationEntry'], 'findMany'>;
      user: Pick<PrismaService['user'], 'findUnique'>;
    },
    @Inject(RedisService)
    private readonly redis: Pick<RedisService, 'get' | 'hgetall' | 'lrange' | 'pipeline'>,
  ) {}

  sanitizeChatContent(raw: string): { sanitized: string; hasIllegalChars: boolean } {
    const normalized = raw.normalize('NFKC');
    const cleaned = replaceControlCharacters(normalized)
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
    if (normalized && FORBIDDEN_HATE_TERMS.some((term) => normalized.includes(term))) {
      return true;
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

    const events = eventsRaw.map(parseProfanityEvent).filter((row): row is ProfanityEvent => row !== null);

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
    if (!requester || !isStaffRole(requester.role)) {
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
            const parsed = parseProfanityEvent(row);
            if (parsed) {
              return {
                ...parsed,
                robotId: robot.id,
                robotName: robot.name,
                robotSlug: robot.slug,
              };
            }
            return null;
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

  private async _assertStaffOrOwner(robotId: string, userId: string) {
    const [robot, user] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    assertStaffOrRobotOwner(robot, user);
  }
}
