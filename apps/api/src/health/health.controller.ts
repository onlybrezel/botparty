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
}
