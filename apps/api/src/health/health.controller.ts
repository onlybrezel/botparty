import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { collectDefaultMetrics, Gauge, register } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BotGateway } from '../gateway/bot.gateway';

let defaultMetricsEnabled = false;

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

    const queueDepth = await this.prisma.queueEntry.count();
    queueDepthGauge.set(queueDepth);

    res.header('Content-Type', register.contentType);
    return res.send(await register.metrics());
  }
}
