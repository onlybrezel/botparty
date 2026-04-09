import { Module } from '@nestjs/common';
import { BotGateway } from './bot.gateway';
import { LivekitModule } from '../livekit/livekit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { QueueModule } from '../queue/queue.module';
import { RobotsModule } from '../robots/robots.module';
import { ModerationModule } from '../moderation/moderation.module';
import { AuthModule } from '../auth/auth.module';
import { ControlsModule } from '../controls/controls.module';

@Module({
  imports: [LivekitModule, SessionsModule, QueueModule, RobotsModule, ModerationModule, AuthModule, ControlsModule],
  providers: [BotGateway],
  exports: [BotGateway],
})
export class GatewayModule {}
