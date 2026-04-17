import { Module, forwardRef } from '@nestjs/common';
import { RobotsService } from './robots.service';
import { RobotTelemetryService } from './robot-telemetry.service';
import { RobotThumbnailService } from './robot-thumbnail.service';
import { RobotAccessService } from './robot-access.service';
import { RobotWebhookService } from './robot-webhook.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { RobotsController } from './robots.controller';
import { LivekitModule } from '../livekit/livekit.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [forwardRef(() => LivekitModule), JwtModule],
  providers: [
    RobotsService,
    RobotTelemetryService,
    RobotThumbnailService,
    RobotAccessService,
    RobotWebhookService,
    ChatPersistenceService,
  ],
  controllers: [RobotsController],
  exports: [
    RobotsService,
    RobotTelemetryService,
    RobotThumbnailService,
    RobotAccessService,
    RobotWebhookService,
    ChatPersistenceService,
  ],
})
export class RobotsModule {}
