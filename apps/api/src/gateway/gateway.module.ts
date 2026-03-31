import { Module } from '@nestjs/common';
import { BotGateway } from './bot.gateway';
import { LivekitModule } from '../livekit/livekit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { QueueModule } from '../queue/queue.module';
import { RobotsModule } from '../robots/robots.module';

@Module({
  imports: [LivekitModule, SessionsModule, QueueModule, RobotsModule],
  providers: [BotGateway],
  exports: [BotGateway],
})
export class GatewayModule {}
