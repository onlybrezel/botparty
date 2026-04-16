import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { RecordingAdminService } from './recording-admin.service';
import { RuntimeTelemetryService } from './runtime-telemetry.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { LivekitModule } from '../livekit/livekit.module';
import { RobotsModule } from '../robots/robots.module';

@Module({
  imports: [PrismaModule, RedisModule, LivekitModule, RobotsModule],
  controllers: [ModerationController],
  providers: [ModerationService, RecordingAdminService, RuntimeTelemetryService],
  exports: [ModerationService, RecordingAdminService, RuntimeTelemetryService],
})
export class ModerationModule {}
