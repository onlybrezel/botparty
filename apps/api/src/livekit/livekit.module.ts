import { Module, forwardRef } from '@nestjs/common';
import { RobotsModule } from '../robots/robots.module';
import { QueueModule } from '../queue/queue.module';
import { LivekitService } from './livekit.service';
import { LivekitController } from './livekit.controller';

@Module({
  imports: [forwardRef(() => RobotsModule), forwardRef(() => QueueModule)],
  providers: [LivekitService],
  controllers: [LivekitController],
  exports: [LivekitService],
})
export class LivekitModule {}
