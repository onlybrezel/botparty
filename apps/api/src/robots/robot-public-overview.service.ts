import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PlatformUserService } from '../wallet/platform-user.service';
import { isRecord, parseJson } from '../common/json-value';
import {
  normalizePublicRobotStatus,
  normalizePublicViewerCount,
  staleRobotCutoff,
  toCount,
} from './robot-public-state';

export interface PublicRobotOverview {
  totals: {
    publicRobots: number;
    liveRobots: number;
    featuredRobots: number;
    totalViewers: number;
    queueEntries: number;
  };
  statusBreakdown: {
    online: number;
    busy: number;
    offline: number;
    maintenance: number;
  };
  featured: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
    viewerCount: number;
    tags: string[];
    owner: {
      username: string;
      displayName: string | null;
    };
  }>;
  liveNow: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
    viewerCount: number;
    queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
    tags: string[];
    owner: {
      username: string;
      displayName: string | null;
    };
  }>;
  topTags: Array<{
    tag: string;
    count: number;
  }>;
}

const ROBOT_STATUSES = ['ONLINE', 'OFFLINE', 'BUSY', 'MAINTENANCE'] as const;
const QUEUE_MODES = ['FIRST_COME', 'VOTING', 'DISABLED'] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRobotStatus(value: unknown): value is PublicRobotOverview['featured'][number]['status'] {
  return typeof value === 'string' && ROBOT_STATUSES.some((status) => status === value);
}

function isQueueMode(value: unknown): value is PublicRobotOverview['liveNow'][number]['queueMode'] {
  return typeof value === 'string' && QUEUE_MODES.some((mode) => mode === value);
}

function parseOwner(value: unknown): PublicRobotOverview['featured'][number]['owner'] | null {
  if (!isRecord(value) || typeof value['username'] !== 'string') return null;
  const displayName = value['displayName'];
  if (displayName !== null && typeof displayName !== 'string') return null;
  return { username: value['username'], displayName };
}

function parseFeaturedRobot(value: unknown): PublicRobotOverview['featured'][number] | null {
  if (!isRecord(value)) return null;
  const owner = parseOwner(value['owner']);
  if (
    !owner || typeof value['id'] !== 'string' || typeof value['name'] !== 'string' ||
    typeof value['slug'] !== 'string' || !isRobotStatus(value['status']) ||
    !isFiniteNumber(value['viewerCount']) || !isStringArray(value['tags'])
  ) return null;
  return {
    id: value['id'], name: value['name'], slug: value['slug'], status: value['status'],
    viewerCount: value['viewerCount'], tags: value['tags'], owner,
  };
}

function parseLiveRobot(value: unknown): PublicRobotOverview['liveNow'][number] | null {
  const base = parseFeaturedRobot(value);
  if (!base || !isRecord(value) || !isQueueMode(value['queueMode'])) return null;
  return { ...base, queueMode: value['queueMode'] };
}

function parsePublicRobotOverview(raw: string): PublicRobotOverview | null {
  const value = parseJson(raw);
  if (!isRecord(value) || !isRecord(value['totals']) || !isRecord(value['statusBreakdown'])) return null;
  const totals = value['totals'];
  const status = value['statusBreakdown'];
  const publicRobots = finiteNumber(totals['publicRobots']);
  const liveRobots = finiteNumber(totals['liveRobots']);
  const featuredRobots = finiteNumber(totals['featuredRobots']);
  const totalViewers = finiteNumber(totals['totalViewers']);
  const queueEntries = finiteNumber(totals['queueEntries']);
  const online = finiteNumber(status['online']);
  const busy = finiteNumber(status['busy']);
  const offline = finiteNumber(status['offline']);
  const maintenance = finiteNumber(status['maintenance']);
  if (
    publicRobots === null || liveRobots === null || featuredRobots === null ||
    totalViewers === null || queueEntries === null || online === null || busy === null ||
    offline === null || maintenance === null
  ) {
    return null;
  }
  if (!Array.isArray(value['featured']) || !Array.isArray(value['liveNow']) || !Array.isArray(value['topTags'])) return null;
  const featured = value['featured'].map(parseFeaturedRobot);
  const liveNow = value['liveNow'].map(parseLiveRobot);
  const topTags = value['topTags'].map((entry) => {
    if (!isRecord(entry) || typeof entry['tag'] !== 'string' || !isFiniteNumber(entry['count'])) return null;
    return { tag: entry['tag'], count: entry['count'] };
  });
  if (featured.some((entry) => entry === null) || liveNow.some((entry) => entry === null) || topTags.some((entry) => entry === null)) {
    return null;
  }

  const validatedFeatured = featured.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const validatedLiveNow = liveNow.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const validatedTopTags = topTags.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return {
    totals: {
      publicRobots, liveRobots, featuredRobots, totalViewers, queueEntries,
    },
    statusBreakdown: {
      online, busy, offline, maintenance,
    },
    featured: validatedFeatured,
    liveNow: validatedLiveNow,
    topTags: validatedTopTags,
  };
}

@Injectable()
export class RobotPublicOverviewService {
  private readonly platformUserId: string;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: {
      $queryRaw: PrismaService['$queryRaw'];
      queueEntry: Pick<PrismaService['queueEntry'], 'count'>;
      robot: Pick<PrismaService['robot'], 'findMany'>;
    },
    @Inject(RedisService) private readonly redis: Pick<RedisService, 'del' | 'get' | 'set'>,
    @Inject(PlatformUserService)
    private readonly platformUser: Pick<PlatformUserService, 'getPlatformUserId'>,
  ) {
    this.platformUserId = this.platformUser.getPlatformUserId();
  }

  async getPublicOverview(): Promise<PublicRobotOverview> {
    const cacheKey = 'robots:public-overview';
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const overview = parsePublicRobotOverview(cached);
      if (overview) return overview;
      await this.redis.del(cacheKey);
    }

    const staleCutoff = staleRobotCutoff();

    const [aggregateRows, queueEntries, topTagRows, featuredRows, liveRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        publicRobots: number | bigint;
        liveRobots: number | bigint;
        featuredRobots: number | bigint;
        totalViewers: number | bigint;
        online: number | bigint;
        busy: number | bigint;
        offline: number | bigint;
        maintenance: number | bigint;
      }>>(Prisma.sql`
        SELECT
          COUNT(*)::int AS "publicRobots",
          SUM(CASE WHEN "status" IN ('ONLINE', 'BUSY') AND "lastOnlineAt" >= ${staleCutoff} THEN 1 ELSE 0 END)::int AS "liveRobots",
          SUM(CASE WHEN "isFeatured" THEN 1 ELSE 0 END)::int AS "featuredRobots",
          SUM(
            CASE
              WHEN "status" = 'MAINTENANCE' THEN GREATEST("viewerCount", 0)
              WHEN "status" IN ('ONLINE', 'BUSY') AND "lastOnlineAt" >= ${staleCutoff} THEN GREATEST("viewerCount", 0)
              ELSE 0
            END
          )::int AS "totalViewers",
          SUM(CASE WHEN "status" = 'ONLINE' AND "lastOnlineAt" >= ${staleCutoff} THEN 1 ELSE 0 END)::int AS "online",
          SUM(CASE WHEN "status" = 'BUSY' AND "lastOnlineAt" >= ${staleCutoff} THEN 1 ELSE 0 END)::int AS "busy",
          SUM(CASE WHEN "status" = 'OFFLINE' OR ("status" IN ('ONLINE', 'BUSY') AND ("lastOnlineAt" IS NULL OR "lastOnlineAt" < ${staleCutoff})) THEN 1 ELSE 0 END)::int AS "offline",
          SUM(CASE WHEN "status" = 'MAINTENANCE' THEN 1 ELSE 0 END)::int AS "maintenance"
        FROM "robots"
        WHERE "visibility" = 'PUBLIC'
          AND "ownerId" != ${this.platformUserId}::uuid
      `),
      this.prisma.queueEntry.count({
        where: {
          robot: {
            visibility: 'PUBLIC',
            ownerId: { not: this.platformUserId },
            status: { in: ['ONLINE', 'BUSY'] },
            lastOnlineAt: { gte: staleCutoff },
          },
        },
      }),
      this.prisma.$queryRaw<Array<{ tag: string; count: number | bigint }>>(Prisma.sql`
        SELECT
          BTRIM(tag) AS tag,
          COUNT(*)::int AS count
        FROM "robots"
        CROSS JOIN LATERAL UNNEST("tags") AS tag_table(tag)
        WHERE "visibility" = 'PUBLIC'
          AND "ownerId" != ${this.platformUserId}::uuid
          AND BTRIM(tag) <> ''
        GROUP BY BTRIM(tag)
        ORDER BY COUNT(*) DESC, BTRIM(tag) ASC
        LIMIT 12
      `),
      this.prisma.robot.findMany({
        where: { visibility: 'PUBLIC', isFeatured: true, ownerId: { not: this.platformUserId } },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          viewerCount: true,
          lastOnlineAt: true,
          tags: true,
          owner: {
            select: {
              username: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ viewerCount: 'desc' }, { createdAt: 'desc' }],
        take: 6,
      }),
      this.prisma.robot.findMany({
        where: {
          visibility: 'PUBLIC',
          ownerId: { not: this.platformUserId },
          status: { in: ['ONLINE', 'BUSY'] },
          lastOnlineAt: { gte: staleCutoff },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          viewerCount: true,
          lastOnlineAt: true,
          queueMode: true,
          tags: true,
          isFeatured: true,
          owner: {
            select: {
              username: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
    ]);

    const aggregates = aggregateRows[0] ?? {
      publicRobots: 0,
      liveRobots: 0,
      featuredRobots: 0,
      totalViewers: 0,
      online: 0,
      busy: 0,
      offline: 0,
      maintenance: 0,
    };

    const overview: PublicRobotOverview = {
      totals: {
        publicRobots: toCount(aggregates.publicRobots),
        liveRobots: toCount(aggregates.liveRobots),
        featuredRobots: toCount(aggregates.featuredRobots),
        totalViewers: toCount(aggregates.totalViewers),
        queueEntries,
      },
      statusBreakdown: {
        online: toCount(aggregates.online),
        busy: toCount(aggregates.busy),
        offline: toCount(aggregates.offline),
        maintenance: toCount(aggregates.maintenance),
      },
      featured: featuredRows.map((robot) => ({
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: normalizePublicRobotStatus(robot.status, robot.lastOnlineAt),
        viewerCount: normalizePublicViewerCount(robot.status, robot.lastOnlineAt, robot.viewerCount),
        tags: robot.tags,
        owner: robot.owner,
      })),
      liveNow: liveRows.map((robot) => ({
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: normalizePublicRobotStatus(robot.status, robot.lastOnlineAt),
        viewerCount: normalizePublicViewerCount(robot.status, robot.lastOnlineAt, robot.viewerCount),
        queueMode: robot.queueMode,
        tags: robot.tags,
        owner: robot.owner,
      })),
      topTags: topTagRows.map((row) => ({ tag: row.tag, count: toCount(row.count) })),
    };

    await this.redis.set(cacheKey, JSON.stringify(overview), 'EX', 30);
    return overview;
  }
}
