import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RobotsModule } from '../robots/robots.module';
import { QueueModule } from '../queue/queue.module';
import { LivekitService } from './livekit.service';
import { LivekitController } from './livekit.controller';
import { RobotCamerasController } from '../robots/robot-cameras.controller';
import { RobotRuntimeController } from '../robots/robot-runtime.controller';
import { RobotRuntimeService } from '../robots/robot-runtime.service';

@Module({
  imports: [AuthModule, RobotsModule, QueueModule],
  providers: [LivekitService, RobotRuntimeService],
  controllers: [LivekitController, RobotCamerasController, RobotRuntimeController],
  exports: [LivekitService],
})
export class LivekitModule {}
