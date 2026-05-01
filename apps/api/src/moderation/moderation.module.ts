import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationAuditService } from './moderation-audit.service';
import { ModerationOverviewService } from './moderation-overview.service';
import { ModerationController } from './moderation.controller';
import { RecordingAdminService } from './recording-admin.service';
import { RuntimeTelemetryService } from './runtime-telemetry.service';
import { RuntimeTelemetryDbService } from './runtime-telemetry-db.service';
import { RuntimeTelemetryGatewayService } from './runtime-telemetry-gateway.service';
import { RuntimeTelemetryLivekitService } from './runtime-telemetry-livekit.service';
import { RuntimeTelemetryCadvisorService } from './runtime-telemetry-cadvisor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { LivekitModule } from '../livekit/livekit.module';
import { RobotsModule } from '../robots/robots.module';

@Module({
  imports: [PrismaModule, RedisModule, LivekitModule, RobotsModule],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    ModerationAuditService,
    ModerationOverviewService,
    RecordingAdminService,
    RuntimeTelemetryService,
    RuntimeTelemetryDbService,
    RuntimeTelemetryGatewayService,
    RuntimeTelemetryLivekitService,
    RuntimeTelemetryCadvisorService,
  ],
  exports: [
    ModerationService,
    ModerationAuditService,
    ModerationOverviewService,
    RecordingAdminService,
    RuntimeTelemetryService,
  ],
})
export class ModerationModule {}
