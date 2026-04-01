import { Module } from '@nestjs/common';
import { RobotsService } from './robots.service';
import { RobotsController } from './robots.controller';
import { LivekitModule } from '../livekit/livekit.module';

@Module({
  imports: [LivekitModule],
  providers: [RobotsService],
  controllers: [RobotsController],
  exports: [RobotsService],
})
export class RobotsModule {}
