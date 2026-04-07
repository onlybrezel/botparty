import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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
}
