import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { RobotsModule } from '../robots/robots.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [JwtModule, RobotsModule, ModerationModule],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
