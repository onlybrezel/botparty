import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { analyticsConsentSchema, analyticsEventSchema, JwtPayload, Role, type AnalyticsEventInput } from '@botparty/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('consent')
  @ApiOperation({ summary: 'Get current product analytics consent' })
  consent(@CurrentUser() user: JwtPayload) {
    return this.analytics.getConsent(user.sub);
  }

  @Patch('consent')
  @ApiOperation({ summary: 'Set or withdraw product analytics consent' })
  updateConsent(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(analyticsConsentSchema)) body: { enabled: boolean },
  ) {
    return this.analytics.setConsent(user.sub, body.enabled);
  }

  @Post('events')
  @ApiOperation({ summary: 'Record a consented first-party product event' })
  ingest(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(analyticsEventSchema)) body: AnalyticsEventInput,
  ) {
    return this.analytics.ingest(user.sub, body);
  }

  @Get('admin/dashboard')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get reproducible product funnel metrics' })
  dashboard(@Query('days') days?: string) {
    return this.analytics.dashboard(Number(days) || 30);
  }
}
