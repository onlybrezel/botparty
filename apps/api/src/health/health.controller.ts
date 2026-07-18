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
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { register } from 'prom-client';

import { hasBasicAuthCredentials, isAuthorizedBasicAuth } from '../common/http-basic-auth';
import { HealthMetricsService } from './health-metrics.service';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthService,
    private readonly healthMetrics: HealthMetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: 'Health check' })
  check() {
    return this.health.getHealthSnapshot();
  }

  @Get('ready')
  @SkipThrottle()
  @ApiOperation({ summary: 'Readiness check for traffic routing' })
  async ready(@Res() reply: FastifyReply) {
    const snapshot = await this.health.getHealthSnapshot();
    return reply.code(snapshot.status === 'healthy' ? 200 : 503).send(snapshot);
  }

  @Get('live')
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness check for container startup probes' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Public platform stats for landing pages and dashboards' })
  stats() {
    return this.health.getPublicStats();
  }

  @Get('metrics')
  @SkipThrottle()
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  async metrics(
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!this.authorizeMetricsRequest(authorization, reply)) return;

    reply.header('Content-Type', register.contentType);
    return reply.send(await this.healthMetrics.render());
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

  private authorizeMetricsRequest(authorization: string | undefined, reply: FastifyReply): boolean {
    const metricsAuthValue = this.config.get<string | boolean>('METRICS_AUTH_REQUIRED');
    const metricsAuthMode =
      typeof metricsAuthValue === 'boolean'
        ? metricsAuthValue
          ? 'true'
          : 'false'
        : metricsAuthValue?.trim().toLowerCase();
    const metricsAuthRequired =
      metricsAuthMode === 'true' ||
      (metricsAuthMode !== 'false' && this.config.get<string>('NODE_ENV') === 'production');

    if (!metricsAuthRequired) return true;

    const username = this.config.get<string>('METRICS_USERNAME')?.trim();
    const password = this.config.get<string>('METRICS_PASSWORD')?.trim();
    if (!hasBasicAuthCredentials(username, password)) {
      throw new InternalServerErrorException(
        'Metrics auth is enabled but METRICS_USERNAME and METRICS_PASSWORD are not configured',
      );
    }

    if (isAuthorizedBasicAuth(authorization, { username, password: password! })) return true;

    reply.header('www-authenticate', 'Basic realm="BotParty Metrics"');
    reply.code(401).send({ message: 'Authentication required' });
    return false;
  }
}
