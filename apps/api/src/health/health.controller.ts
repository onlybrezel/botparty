import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { collectDefaultMetrics, Gauge, register } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BotGateway } from '../gateway/bot.gateway';
import { hasBasicAuthCredentials, isAuthorizedBasicAuth } from '../common/http-basic-auth';
import { Throttle } from '@nestjs/throttler';
import { LivekitService } from '../livekit/livekit.service';
import { MailService } from '../mail/mail.service';
import { FeatureFlagsService } from '../common/feature-flags.service';

let defaultMetricsEnabled = false;
const ROBOT_TELEMETRY_FRESH_WINDOW_MS = 180_000;

type RobotTelemetrySummary = {
  freshRobots: number;
  controlConnectedRobots: number;
  livekitConnectedRobots: number;
  avgCpuPercent: number;
  avgMemoryPercent: number;
  avgTemperatureC: number;
};

function getOrCreateGauge(name: string, help: string): Gauge<string> {
  const existing = register.getSingleMetric(name);
  if (existing) {
    return existing as Gauge<string>;
  }
  return new Gauge({ name, help });
}

const wsConnectedClientsGauge = getOrCreateGauge(
  'botparty_ws_connected_clients',
  'Total number of connected websocket clients',
);
const wsConnectedRobotsGauge = getOrCreateGauge(
  'botparty_ws_connected_robot_clients',
  'Total number of connected robot websocket clients',
);
const wsRoomsGauge = getOrCreateGauge(
  'botparty_ws_active_rooms',
  'Total number of active websocket rooms',
);
const wsRoomMembershipsGauge = getOrCreateGauge(
  'botparty_ws_room_memberships',
  'Total number of websocket room memberships',
);
const wsActiveTurnsGauge = getOrCreateGauge(
  'botparty_ws_active_turns',
  'Total number of active control turns',
);
const wsControlCooldownsGauge = getOrCreateGauge(
  'botparty_ws_control_cooldowns',
  'Total number of tracked control cooldown entries',
);
const queueDepthGauge = getOrCreateGauge(
  'botparty_queue_depth',
  'Total queue depth across all robots',
);
const databaseUpGauge = getOrCreateGauge(
  'botparty_dependency_database_up',
  'Whether the API can reach the database (1=up, 0=down)',
);
const redisUpGauge = getOrCreateGauge(
  'botparty_dependency_redis_up',
  'Whether the API can reach Redis (1=up, 0=down)',
);
const robotTelemetryFreshGauge = getOrCreateGauge(
  'botparty_robot_telemetry_fresh_robots',
  'Number of robots with telemetry received in the last 180 seconds',
);
const robotTelemetryControlConnectedGauge = getOrCreateGauge(
  'botparty_robot_telemetry_control_connected_robots',
  'Number of robots with fresh telemetry and an active control connection',
);
const robotTelemetryLivekitConnectedGauge = getOrCreateGauge(
  'botparty_robot_telemetry_livekit_connected_robots',
  'Number of robots with fresh telemetry and an active LiveKit connection',
);
const robotTelemetryAvgCpuGauge = getOrCreateGauge(
  'botparty_robot_telemetry_avg_cpu_percent',
  'Average CPU percent across robots with fresh telemetry',
);
const robotTelemetryAvgMemoryGauge = getOrCreateGauge(
  'botparty_robot_telemetry_avg_memory_percent',
  'Average memory percent across robots with fresh telemetry',
);
const robotTelemetryAvgTemperatureGauge = getOrCreateGauge(
  'botparty_robot_telemetry_avg_temperature_c',
  'Average temperature in Celsius across robots with fresh telemetry',
);
const queueOldestAgeGauge = getOrCreateGauge(
  'botparty_queue_oldest_entry_age_seconds',
  'Age of the oldest active queue entry in seconds',
);
const billingNeedsReviewGauge = getOrCreateGauge(
  'botparty_billing_needs_review',
  'Billing intents that require manual review',
);
const notificationEmailFailedGauge = getOrCreateGauge(
  'botparty_notification_email_failed',
  'Notification email outbox rows in terminal failed state',
);
const webhookDeliveryFailedGauge = getOrCreateGauge(
  'botparty_webhook_delivery_failed',
  'Active robot webhooks whose latest delivery failed',
);
const databaseConnectionsGauge = getOrCreateGauge(
  'botparty_database_connections',
  'Current PostgreSQL connections for the BotParty database',
);
const redisMemoryBytesGauge = getOrCreateGauge(
  'botparty_redis_memory_used_bytes',
  'Redis memory currently in use',
);
const livekitUpGauge = getOrCreateGauge(
  'botparty_dependency_livekit_up',
  'Whether the API can reach LiveKit (1=up, 0=down)',
);
const objectStorageUpGauge = getOrCreateGauge(
  'botparty_dependency_object_storage_up',
  'Whether the API can reach object storage (1=up, 0=down)',
);

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: BotGateway,
    private readonly config: ConfigService,
    private readonly livekit: LivekitService,
    private readonly mail: MailService,
    private readonly features: FeatureFlagsService,
  ) {
    if (!defaultMetricsEnabled) {
      collectDefaultMetrics({ prefix: 'botparty_api_' });
      defaultMetricsEnabled = true;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    return this.buildHealthSnapshot();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check for traffic routing' })
  async ready(@Res() reply: FastifyReply) {
    const snapshot = await this.buildHealthSnapshot();
    return reply.code(snapshot.status === 'healthy' ? 200 : 503).send(snapshot);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness check for container startup probes' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Public platform stats for landing pages and dashboards' })
  async stats() {
    const [
      totalUsers,
      totalRobots,
      liveRobots,
      totalLiveViewers,
      activeQueueEntries,
      totalSessions,
    ] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.robot.count(),
      this.prisma.robot.count({ where: { status: { in: ['ONLINE', 'BUSY'] } } }),
      this.prisma.robot.aggregate({ _sum: { viewerCount: true } }),
      this.prisma.queueEntry.count(),
      this.prisma.session.count(),
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

  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  async metrics(
    @Headers('authorization') authorization: string | undefined,
    @Res() res: FastifyReply,
  ) {
    if (!this._authorizeMetricsRequest(authorization, res)) {
      return;
    }

    const ws = this.gateway.getRuntimeMetricsSnapshot();
    wsConnectedClientsGauge.set(ws.connectedClients);
    wsConnectedRobotsGauge.set(ws.connectedRobotClients);
    wsRoomsGauge.set(ws.activeRooms);
    wsRoomMembershipsGauge.set(ws.roomMemberships);
    wsActiveTurnsGauge.set(ws.activeTurns);
    wsControlCooldownsGauge.set(ws.controlCooldowns);

    const [databaseUp, redisUp, queueDepth, robotTelemetry, operational] = await Promise.all([
      this._checkDatabaseUp(),
      this._checkRedisUp(),
      this._getQueueDepth(),
      this._getRobotTelemetrySummary(),
      this._getOperationalMetrics(),
    ]);

    databaseUpGauge.set(databaseUp);
    redisUpGauge.set(redisUp);
    queueDepthGauge.set(queueDepth);
    robotTelemetryFreshGauge.set(robotTelemetry.freshRobots);
    robotTelemetryControlConnectedGauge.set(robotTelemetry.controlConnectedRobots);
    robotTelemetryLivekitConnectedGauge.set(robotTelemetry.livekitConnectedRobots);
    robotTelemetryAvgCpuGauge.set(robotTelemetry.avgCpuPercent);
    robotTelemetryAvgMemoryGauge.set(robotTelemetry.avgMemoryPercent);
    robotTelemetryAvgTemperatureGauge.set(robotTelemetry.avgTemperatureC);
    queueOldestAgeGauge.set(operational.oldestQueueAgeSec);
    billingNeedsReviewGauge.set(operational.billingNeedsReview);
    notificationEmailFailedGauge.set(operational.failedEmails);
    webhookDeliveryFailedGauge.set(operational.failedWebhooks);
    databaseConnectionsGauge.set(operational.databaseConnections);
    redisMemoryBytesGauge.set(operational.redisMemoryBytes);
    livekitUpGauge.set(operational.livekitUp);
    objectStorageUpGauge.set(operational.objectStorageUp);

    res.header('Content-Type', register.contentType);
    return res.send(await register.metrics());
  }

  @Post('csp-report')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RouteConfig({ bodyLimit: 16_384 })
  @ApiOperation({ summary: 'Receive browser Content Security Policy violation reports' })
  cspReport(@Body() body: unknown) {
    const serialized = JSON.stringify(body ?? {});
    if (Buffer.byteLength(serialized, 'utf8') > 16_384) throw new PayloadTooLargeException();
    const report =
      body && typeof body === 'object' && 'csp-report' in body
        ? (body as Record<string, unknown>)['csp-report']
        : body;
    const fields = report && typeof report === 'object' ? (report as Record<string, unknown>) : {};
    const directive =
      typeof fields['violated-directive'] === 'string'
        ? fields['violated-directive'].slice(0, 128)
        : 'unknown';
    this.logger.warn(`CSP violation: ${directive}`);
  }

  private async _checkDatabaseUp(): Promise<number> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 1;
    } catch {
      return 0;
    }
  }

  private async buildHealthSnapshot() {
    const [databaseUp, redisUp, livekitUp] = await Promise.all([
      this._checkDatabaseUp(),
      this._checkRedisUp(),
      this.livekit
        .listRooms([])
        .then(() => 1)
        .catch(() => 0),
    ]);
    const billingEnabled = this.features.isEnabled('BILLING');
    const mailRequired =
      String(this.config.get('REQUIRE_EMAIL_VERIFICATION') ?? 'false') === 'true';
    const checks = {
      discovery: databaseUp ? 'ok' : 'error',
      auth: databaseUp && redisUp && (!mailRequired || this.mail.isEnabled()) ? 'ok' : 'error',
      control: databaseUp && redisUp ? 'ok' : 'error',
      video: livekitUp ? 'ok' : 'error',
      payments: billingEnabled ? (databaseUp ? 'ok' : 'error') : 'disabled',
    } as const;
    const coreHealthy =
      checks.discovery === 'ok' &&
      checks.auth === 'ok' &&
      checks.control === 'ok' &&
      checks.video === 'ok';
    return {
      status: coreHealthy ? ('healthy' as const) : ('degraded' as const),
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async _checkRedisUp(): Promise<number> {
    try {
      await this.redis.ping();
      return 1;
    } catch {
      return 0;
    }
  }

  private async _getQueueDepth(): Promise<number> {
    try {
      return await this.prisma.queueEntry.count();
    } catch {
      return 0;
    }
  }

  private async _getOperationalMetrics() {
    const [
      oldestQueue,
      billingNeedsReview,
      failedEmails,
      failedWebhooks,
      databaseConnections,
      redisInfo,
      livekitUp,
      objectStorageUp,
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
      this._checkObjectStorage(),
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
    };
  }

  private async _checkObjectStorage() {
    const endpoint = this.config.get<string>('THUMBNAIL_S3_ENDPOINT')?.replace(/\/$/, '');
    if (!endpoint) return 0;
    try {
      const response = await fetch(`${endpoint}/minio/health/live`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok ? 1 : 0;
    } catch {
      return 0;
    }
  }

  private async _getRobotTelemetrySummary(): Promise<RobotTelemetrySummary> {
    const emptySummary: RobotTelemetrySummary = {
      freshRobots: 0,
      controlConnectedRobots: 0,
      livekitConnectedRobots: 0,
      avgCpuPercent: 0,
      avgMemoryPercent: 0,
      avgTemperatureC: 0,
    };

    try {
      const robots = await this.prisma.robot.findMany({ select: { id: true } });
      if (robots.length === 0) {
        return emptySummary;
      }

      const telemetryRaw = await this.redis.mget(
        ...robots.map((robot) => `robot:telemetry:${robot.id}:latest`),
      );
      const now = Date.now();
      const cpuSamples: number[] = [];
      const memorySamples: number[] = [];
      const temperatureSamples: number[] = [];

      let freshRobots = 0;
      let controlConnectedRobots = 0;
      let livekitConnectedRobots = 0;

      for (const raw of telemetryRaw) {
        if (!raw) {
          continue;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }

        const telemetryTs = this._asNumber(parsed.ts);
        if (telemetryTs === null || now - telemetryTs > ROBOT_TELEMETRY_FRESH_WINDOW_MS) {
          continue;
        }

        freshRobots += 1;
        if (parsed.controlConnected) {
          controlConnectedRobots += 1;
        }
        if (parsed.livekitConnected) {
          livekitConnectedRobots += 1;
        }

        const cpuPercent = this._asNumber(parsed.cpuPercent);
        if (cpuPercent !== null) {
          cpuSamples.push(cpuPercent);
        }

        const memoryPercent = this._asNumber(parsed.memoryPercent);
        if (memoryPercent !== null) {
          memorySamples.push(memoryPercent);
        }

        const temperatureC = this._asNumber(parsed.temperatureC);
        if (temperatureC !== null) {
          temperatureSamples.push(temperatureC);
        }
      }

      return {
        freshRobots,
        controlConnectedRobots,
        livekitConnectedRobots,
        avgCpuPercent: this._average(cpuSamples),
        avgMemoryPercent: this._average(memorySamples),
        avgTemperatureC: this._average(temperatureSamples),
      };
    } catch {
      return emptySummary;
    }
  }

  private _asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private _average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
  }

  private _authorizeMetricsRequest(authorization: string | undefined, res: FastifyReply): boolean {
    const metricsAuthMode = this.config.get<string>('METRICS_AUTH_REQUIRED')?.trim().toLowerCase();
    const metricsAuthRequired =
      metricsAuthMode === 'true' ||
      (metricsAuthMode !== 'false' && this.config.get<string>('NODE_ENV') === 'production');

    if (!metricsAuthRequired) {
      return true;
    }

    const username = this.config.get<string>('METRICS_USERNAME')?.trim();
    const password = this.config.get<string>('METRICS_PASSWORD')?.trim();
    if (!hasBasicAuthCredentials(username, password)) {
      throw new InternalServerErrorException(
        'Metrics auth is enabled but METRICS_USERNAME and METRICS_PASSWORD are not configured',
      );
    }

    const authorized = isAuthorizedBasicAuth(authorization, { username, password: password! });
    if (authorized) {
      return true;
    }

    res.header('www-authenticate', 'Basic realm="BotParty Metrics"');
    res.code(401).send({ message: 'Authentication required' });
    return false;
  }
}
