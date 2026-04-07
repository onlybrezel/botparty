import { Module, forwardRef } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { RobotsModule } from '../robots/robots.module';

@Module({
  imports: [forwardRef(() => RobotsModule)],
  providers: [QueueService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule {}
