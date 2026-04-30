import { Injectable } from '@nestjs/common';
import { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PlatformUserService } from '../wallet/platform-user.service';
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

@Injectable()
export class RobotPublicOverviewService {
  private readonly platformUserId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly platformUser: PlatformUserService,
  ) {
    this.platformUserId = this.platformUser.getPlatformUserId();
  }

  async getPublicOverview(): Promise<PublicRobotOverview> {
    const cacheKey = 'robots:public-overview';
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PublicRobotOverview;
      } catch {
        await this.redis.del(cacheKey);
      }
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
