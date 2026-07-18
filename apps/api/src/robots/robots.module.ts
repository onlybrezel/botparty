import { Module } from '@nestjs/common';
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
import { RobotWebhooksController } from './robot-webhooks.controller';
import { RobotSecretsController } from './robot-secrets.controller';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { StorageDeletionModule } from '../storage/storage-deletion.module';

@Module({
  imports: [
    AuthModule,
    StorageDeletionModule,
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
  ],
  controllers: [RobotsController, RobotWebhooksController, RobotSecretsController],
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
