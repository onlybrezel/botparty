import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { LivekitModule } from '../livekit/livekit.module';
import { MailModule } from '../mail/mail.module';
import { HealthService } from './health.service';
import { HealthMetricsService } from './health-metrics.service';

@Module({
  imports: [GatewayModule, LivekitModule, MailModule],
  controllers: [HealthController],
  providers: [HealthService, HealthMetricsService],
})
export class HealthModule {}
