import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { LivekitModule } from '../livekit/livekit.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [GatewayModule, LivekitModule, MailModule],
  controllers: [HealthController],
})
export class HealthModule {}
