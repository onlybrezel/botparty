import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { collectDefaultMetrics, Gauge, register } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BotGateway } from '../gateway/bot.gateway';

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

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: BotGateway,
  ) {
    if (!defaultMetricsEnabled) {
      collectDefaultMetrics({ prefix: 'botparty_api_' });
      defaultMetricsEnabled = true;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const checks: Record<string, string> = { api: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'error';
    }

    try {
      await this.redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    return { status: healthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() };
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
  async metrics(@Res() res: FastifyReply) {
    const ws = this.gateway.getRuntimeMetricsSnapshot();
    wsConnectedClientsGauge.set(ws.connectedClients);
    wsConnectedRobotsGauge.set(ws.connectedRobotClients);
    wsRoomsGauge.set(ws.activeRooms);
    wsRoomMembershipsGauge.set(ws.roomMemberships);
    wsActiveTurnsGauge.set(ws.activeTurns);
    wsControlCooldownsGauge.set(ws.controlCooldowns);

    const [databaseUp, redisUp, queueDepth, robotTelemetry] = await Promise.all([
      this._checkDatabaseUp(),
      this._checkRedisUp(),
      this._getQueueDepth(),
      this._getRobotTelemetrySummary(),
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

    res.header('Content-Type', register.contentType);
    return res.send(await register.metrics());
  }

  private async _checkDatabaseUp(): Promise<number> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 1;
    } catch {
      return 0;
    }
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

      const telemetryRaw = await this.redis.mget(...robots.map((robot) => `robot:telemetry:${robot.id}:latest`));
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
        if (Boolean(parsed.controlConnected)) {
          controlConnectedRobots += 1;
        }
        if (Boolean(parsed.livekitConnected)) {
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
}
