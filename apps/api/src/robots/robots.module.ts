import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JOBS_QUEUE_WEBHOOK } from '../jobs/jobs.constants';
import { RobotsService } from './robots.service';
import { RobotTelemetryService } from './robot-telemetry.service';
import { RobotThumbnailService } from './robot-thumbnail.service';
import { RobotAccessService } from './robot-access.service';
import { RobotWebhookService } from './robot-webhook.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { RobotDeviceService } from './robot-device.service';
import { RobotSlugService } from './robot-slug.service';
import { RobotInviteService } from './robot-invite.service';
import { RobotCameraService } from './robot-camera.service';
import { RobotActionQueueService } from './robot-action-queue.service';
import { RobotPublicOverviewService } from './robot-public-overview.service';
import { RobotsController } from './robots.controller';
import { RobotRuntimeService } from './robot-runtime.service';
import { RobotRuntimeController } from './robot-runtime.controller';
import { RobotWebhooksController } from './robot-webhooks.controller';
import { RobotCamerasController } from './robot-cameras.controller';
import { RobotSecretsController } from './robot-secrets.controller';
import { LivekitModule } from '../livekit/livekit.module';
import { JwtModule } from '@nestjs/jwt';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    forwardRef(() => LivekitModule),
    JwtModule,
    BullModule.registerQueue({ name: JOBS_QUEUE_WEBHOOK }),
    WalletModule,
  ],
  providers: [
    RobotsService,
    RobotTelemetryService,
    RobotThumbnailService,
    RobotAccessService,
    RobotWebhookService,
    ChatPersistenceService,
    RobotDeviceService,
    RobotSlugService,
    RobotInviteService,
    RobotCameraService,
    RobotActionQueueService,
    RobotPublicOverviewService,
    RobotRuntimeService,
  ],
  controllers: [
    RobotsController,
    RobotRuntimeController,
    RobotWebhooksController,
    RobotCamerasController,
    RobotSecretsController,
  ],
  exports: [
    RobotsService,
    RobotTelemetryService,
    RobotThumbnailService,
    RobotAccessService,
    RobotWebhookService,
    ChatPersistenceService,
    RobotDeviceService,
    RobotSlugService,
    RobotInviteService,
    RobotCameraService,
    RobotActionQueueService,
    RobotPublicOverviewService,
  ],
})
export class RobotsModule {}
