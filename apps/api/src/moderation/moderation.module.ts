import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { LivekitModule } from '../livekit/livekit.module';
import { RobotsModule } from '../robots/robots.module';

@Module({
  imports: [PrismaModule, RedisModule, LivekitModule, RobotsModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
