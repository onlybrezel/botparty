import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@botparty/prisma';
import { HeadBucketCommand } from '@aws-sdk/client-s3';

import {
  createS3CompatibleStorageClient,
  resolveS3CompatibleStorageConfig,
} from '../common/s3-compatible-storage';
import { FeatureFlagsService } from '../common/feature-flags.service';
import { isRecord } from '../common/json-value';
import { LivekitService } from '../livekit/livekit.service';
import { MailService } from '../mail/mail.service';
import { PrismaReadService } from '../prisma/prisma-read.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const ROBOT_TELEMETRY_FRESH_WINDOW_MS = 180_000;
const DEPENDENCY_CHECK_TIMEOUT_MS = 1_500;
const PUBLIC_STATS_CACHE_TTL_MS = 5_000;
const ROBOT_TELEMETRY_BATCH_SIZE = 250;

type PublicStatsDatabase = {
  user: Pick<PrismaClient['user'], 'count'>;
  robot: Pick<PrismaClient['robot'], 'aggregate' | 'count'>;
  queueEntry: Pick<PrismaClient['queueEntry'], 'count'>;
  session: Pick<PrismaClient['session'], 'count'>;
};

type HealthDatabase = PublicStatsDatabase & {
  $queryRaw: PrismaService['$queryRaw'];
  billingIntent: Pick<PrismaService['billingIntent'], 'count'>;
  notification: Pick<PrismaService['notification'], 'count'>;
  queueEntry: Pick<PrismaService['queueEntry'], 'count' | 'findFirst'>;
  robot: Pick<PrismaService['robot'], 'aggregate' | 'count' | 'findMany'>;
  robotWebhook: Pick<PrismaService['robotWebhook'], 'count'>;
};

type HealthReadDatabase = Pick<PrismaReadService, 'isAvailable' | 'isReplicaConfigured'> & {
  readonly client: PublicStatsDatabase;
};

async function resolveWithin<T>(operation: Promise<T>, fallback: T): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), DEPENDENCY_CHECK_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type RobotTelemetrySummary = {
  freshRobots: number;
  controlConnectedRobots: number;
  livekitConnectedRobots: number;
  avgCpuPercent: number;
  avgMemoryPercent: number;
  avgTemperatureC: number;
};

type RobotTelemetryAccumulator = {
  freshRobots: number;
  controlConnectedRobots: number;
  livekitConnectedRobots: number;
  cpuSum: number;
  cpuSamples: number;
  memorySum: number;
  memorySamples: number;
  temperatureSum: number;
  temperatureSamples: number;
};

type PublicStatsSnapshot = {
  totalUsers: number;
  totalRobots: number;
  liveRobots: number;
  totalLiveViewers: number;
  activeQueueEntries: number;
  totalSessions: number;
  timestamp: string;
};

export type HealthMetricsSnapshot = {
  databaseUp: number;
  redisUp: number;
  queueDepth: number;
  robotTelemetry: RobotTelemetrySummary;
  oldestQueueAgeSec: number;
  billingNeedsReview: number;
  failedEmails: number;
  failedWebhooks: number;
  databaseConnections: number;
  redisMemoryBytes: number;
  livekitUp: number;
  objectStorageUp: number;
  readReplicaUp: number;
  readReplicaConfigured: number;
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private publicStatsCache: { expiresAt: number; value: PublicStatsSnapshot } | null = null;
  private publicStatsRefresh: Promise<PublicStatsSnapshot> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: HealthDatabase,
    @Inject(RedisService) private readonly redis: Pick<RedisService, 'info' | 'mget' | 'ping'>,
    @Inject(ConfigService) private readonly config: Pick<ConfigService, 'get'>,
    @Inject(LivekitService) private readonly livekit: Pick<LivekitService, 'listRooms'>,
    @Inject(MailService) private readonly mail: Pick<MailService, 'isAvailable'>,
    @Inject(FeatureFlagsService) private readonly features: Pick<FeatureFlagsService, 'isEnabled'>,
    @Inject(PrismaReadService) private readonly readPrisma: HealthReadDatabase,
  ) {}

  async getHealthSnapshot() {
    const [databaseUp, migrationsUp, redisUp, livekitUp, objectStorageUp] = await Promise.all([
      this.checkDatabaseUp(),
      this.checkMigrationsUp(),
      this.checkRedisUp(),
      resolveWithin(
        this.livekit
          .listRooms([])
          .then(() => 1)
          .catch(() => 0),
        0,
      ),
      this.checkObjectStorage(),
    ]);
    const billingEnabled = this.features.isEnabled('BILLING');
    const mailRequired =
      String(this.config.get('REQUIRE_EMAIL_VERIFICATION') ?? 'false') === 'true';
    const checks = {
      discovery: databaseUp ? 'ok' : 'error',
      migrations: migrationsUp ? 'ok' : 'error',
      auth: databaseUp && redisUp && (!mailRequired || this.mail.isAvailable()) ? 'ok' : 'error',
      control: databaseUp && redisUp ? 'ok' : 'error',
      video: livekitUp ? 'ok' : 'error',
      storage: objectStorageUp ? 'ok' : 'error',
      payments: billingEnabled ? (databaseUp ? 'ok' : 'error') : 'disabled',
    } as const;
    const coreHealthy =
      checks.discovery === 'ok' &&
      checks.migrations === 'ok' &&
      checks.auth === 'ok' &&
      checks.control === 'ok' &&
      checks.video === 'ok' &&
      checks.storage === 'ok';

    return {
      status: coreHealthy ? ('healthy' as const) : ('degraded' as const),
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  async getPublicStats() {
    const now = Date.now();
    if (this.publicStatsCache && this.publicStatsCache.expiresAt > now) {
      return this.publicStatsCache.value;
    }
    if (this.publicStatsRefresh) return this.publicStatsRefresh;

    this.publicStatsRefresh = this.loadPublicStats()
      .then((value) => {
        this.publicStatsCache = { expiresAt: Date.now() + PUBLIC_STATS_CACHE_TTL_MS, value };
        return value;
      })
      .finally(() => {
        this.publicStatsRefresh = null;
      });
    return this.publicStatsRefresh;
  }

  private async loadPublicStats() {
    try {
      return await this.buildPublicStats(this.readPrisma.client);
    } catch (error) {
      if (!this.readPrisma.isReplicaConfigured) throw error;
      this.logger.warn(
        `Read replica unavailable for public stats; using primary: ${(error as Error).message}`,
      );
      return this.buildPublicStats(this.prisma);
    }
  }

  async getMetricsSnapshot(): Promise<HealthMetricsSnapshot> {
    const [databaseUp, redisUp, queueDepth, robotTelemetry, operational] = await Promise.all([
      this.checkDatabaseUp(),
      this.checkRedisUp(),
      this.getQueueDepth(),
      this.getRobotTelemetrySummary(),
      this.getOperationalMetrics(),
    ]);

    return {
      databaseUp,
      redisUp,
      queueDepth,
      robotTelemetry,
      ...operational,
      readReplicaConfigured: this.readPrisma.isReplicaConfigured ? 1 : 0,
    };
  }

  private async buildPublicStats(database: PublicStatsDatabase) {
    const [
      totalUsers,
      totalRobots,
      liveRobots,
      totalLiveViewers,
      activeQueueEntries,
      totalSessions,
    ] = await Promise.all([
      database.user.count({ where: { isActive: true } }),
      database.robot.count(),
      database.robot.count({ where: { status: { in: ['ONLINE', 'BUSY'] } } }),
      database.robot.aggregate({ _sum: { viewerCount: true } }),
      database.queueEntry.count(),
      database.session.count(),
    ]);

    return {
      totalUsers,
      totalRobots,
      liveRobots,
      totalLiveViewers: totalLiveViewers._sum.viewerCount ?? 0,
      activeQueueEntries,
      totalSessions,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabaseUp(): Promise<number> {
    return resolveWithin(
      this.prisma.$queryRaw`SELECT 1`.then(() => 1).catch(() => 0),
      0,
    );
  }

  private async checkRedisUp(): Promise<number> {
    return resolveWithin(
      this.redis
        .ping()
        .then(() => 1)
        .catch(() => 0),
      0,
    );
  }

  private async checkMigrationsUp(): Promise<number> {
    const migrationCheck = this.prisma.$queryRaw<Array<{ total: bigint; pending: bigint }>>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        )::bigint AS pending
      FROM "_prisma_migrations"
    `
      .then((rows) => {
        const state = rows[0];
        return Number(state?.total ?? 0) > 0 && Number(state?.pending ?? 0) === 0 ? 1 : 0;
      })
      .catch(() => 0);
    return resolveWithin(migrationCheck, 0);
  }

  private async getQueueDepth(): Promise<number> {
    try {
      return await this.prisma.queueEntry.count();
    } catch {
      return 0;
    }
  }

  private async getOperationalMetrics() {
    const [
      oldestQueue,
      billingNeedsReview,
      failedEmails,
      failedWebhooks,
      databaseConnections,
      redisInfo,
      livekitUp,
      objectStorageUp,
      readReplicaUp,
    ] = await Promise.all([
      this.prisma.queueEntry
        .findFirst({ orderBy: { joinedAt: 'asc' }, select: { joinedAt: true } })
        .catch(() => null),
      this.prisma.billingIntent.count({ where: { status: 'NEEDS_REVIEW' } }).catch(() => 0),
      this.prisma.notification.count({ where: { emailStatus: 'FAILED' } }).catch(() => 0),
      this.prisma.robotWebhook
        .count({
          where: {
            isActive: true,
            lastTriggeredAt: { not: null },
            lastStatusCode: null,
          },
        })
        .catch(() => 0),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()
      `
        .then((rows) => Number(rows[0]?.count ?? 0))
        .catch(() => 0),
      this.redis.info('memory').catch(() => ''),
      this.livekit
        .listRooms([])
        .then(() => 1)
        .catch(() => 0),
      this.checkObjectStorage(),
      this.readPrisma.isAvailable().then((available) => (available ? 1 : 0)),
    ]);
    const memoryMatch = /(?:^|\r?\n)used_memory:(\d+)/.exec(redisInfo);

    return {
      oldestQueueAgeSec: oldestQueue
        ? Math.max(0, (Date.now() - oldestQueue.joinedAt.getTime()) / 1000)
        : 0,
      billingNeedsReview,
      failedEmails,
      failedWebhooks,
      databaseConnections,
      redisMemoryBytes: Number(memoryMatch?.[1] ?? 0),
      livekitUp,
      objectStorageUp,
      readReplicaUp,
    };
  }

  private async checkObjectStorage() {
    try {
      const storage = resolveS3CompatibleStorageConfig(this.config, 'THUMBNAIL_S3_');
      if (!storage) return 0;
      const client = createS3CompatibleStorageClient(storage);
      await client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
      return 1;
    } catch {
      // SeaweedFS / generic S3: unauthenticated root often answers 403 when the gateway is up.
      const endpoint = this.config.get<string>('THUMBNAIL_S3_ENDPOINT')?.replace(/\/$/, '');
      if (!endpoint) return 0;
      try {
        const response = await fetch(`${endpoint}/`, {
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok || response.status === 403 ? 1 : 0;
      } catch {
        return 0;
      }
    }
  }

  private async getRobotTelemetrySummary(): Promise<RobotTelemetrySummary> {
    const emptySummary: RobotTelemetrySummary = {
      freshRobots: 0,
      controlConnectedRobots: 0,
      livekitConnectedRobots: 0,
      avgCpuPercent: 0,
      avgMemoryPercent: 0,
      avgTemperatureC: 0,
    };

    try {
      const accumulator: RobotTelemetryAccumulator = {
        freshRobots: 0,
        controlConnectedRobots: 0,
        livekitConnectedRobots: 0,
        cpuSum: 0,
        cpuSamples: 0,
        memorySum: 0,
        memorySamples: 0,
        temperatureSum: 0,
        temperatureSamples: 0,
      };
      const now = Date.now();
      let cursor: string | undefined;

      while (true) {
        const robots = await this.prisma.robot.findMany({
          select: { id: true },
          orderBy: { id: 'asc' },
          take: ROBOT_TELEMETRY_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (robots.length === 0) break;

        const telemetryRows = await this.redis.mget(
          ...robots.map((robot) => `robot:telemetry:${robot.id}:latest`),
        );
        this.accumulateTelemetry(telemetryRows, now, accumulator);
        if (robots.length < ROBOT_TELEMETRY_BATCH_SIZE) break;
        cursor = robots[robots.length - 1]?.id;
        if (!cursor) break;
      }

      return this.toTelemetrySummary(accumulator);
    } catch {
      return emptySummary;
    }
  }

  private accumulateTelemetry(
    telemetryRows: Array<string | null>,
    now: number,
    accumulator: RobotTelemetryAccumulator,
  ): void {
    for (const rawTelemetry of telemetryRows) {
      const telemetry = this.parseFreshTelemetry(rawTelemetry, now);
      if (!telemetry) continue;

      accumulator.freshRobots += 1;
      if (telemetry['controlConnected']) accumulator.controlConnectedRobots += 1;
      if (telemetry['livekitConnected']) accumulator.livekitConnectedRobots += 1;

      this.collectNumber(telemetry['cpuPercent'], accumulator, 'cpu');
      this.collectNumber(telemetry['memoryPercent'], accumulator, 'memory');
      this.collectNumber(telemetry['temperatureC'], accumulator, 'temperature');
    }
  }

  private toTelemetrySummary(accumulator: RobotTelemetryAccumulator): RobotTelemetrySummary {
    return {
      freshRobots: accumulator.freshRobots,
      controlConnectedRobots: accumulator.controlConnectedRobots,
      livekitConnectedRobots: accumulator.livekitConnectedRobots,
      avgCpuPercent: this.average(accumulator.cpuSum, accumulator.cpuSamples),
      avgMemoryPercent: this.average(accumulator.memorySum, accumulator.memorySamples),
      avgTemperatureC: this.average(accumulator.temperatureSum, accumulator.temperatureSamples),
    };
  }

  private parseFreshTelemetry(rawTelemetry: string | null, now: number) {
    if (!rawTelemetry) return null;

    let telemetry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawTelemetry);
      if (!isRecord(parsed)) return null;
      telemetry = parsed;
    } catch {
      return null;
    }

    const timestamp = this.asNumber(telemetry['ts']);
    if (timestamp === null || now - timestamp > ROBOT_TELEMETRY_FRESH_WINDOW_MS) return null;
    return telemetry;
  }

  private collectNumber(
    value: unknown,
    accumulator: RobotTelemetryAccumulator,
    metric: 'cpu' | 'memory' | 'temperature',
  ) {
    const number = this.asNumber(value);
    if (number === null) return;
    if (metric === 'cpu') {
      accumulator.cpuSum += number;
      accumulator.cpuSamples += 1;
    } else if (metric === 'memory') {
      accumulator.memorySum += number;
      accumulator.memorySamples += 1;
    } else {
      accumulator.temperatureSum += number;
      accumulator.temperatureSamples += 1;
    }
  }

  private asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private average(sum: number, sampleCount: number): number {
    if (sampleCount === 0) return 0;
    return Number((sum / sampleCount).toFixed(1));
  }
}
