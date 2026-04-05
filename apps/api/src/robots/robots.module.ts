import { Module } from '@nestjs/common';
import { RobotsService } from './robots.service';
import { RobotsController } from './robots.controller';
import { LivekitModule } from '../livekit/livekit.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [LivekitModule, JwtModule],
  providers: [RobotsService],
  controllers: [RobotsController],
  exports: [RobotsService],
})
export class RobotsModule {}
