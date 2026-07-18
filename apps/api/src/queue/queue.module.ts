import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { RobotsModule } from '../robots/robots.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [RobotsModule, AuthModule],
  providers: [QueueService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule {}
