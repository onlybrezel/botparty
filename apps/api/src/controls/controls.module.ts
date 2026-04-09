import { Module } from '@nestjs/common';
import { ControlsService } from './controls.service';
import { ControlsController } from './controls.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RobotsModule } from '../robots/robots.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, RobotsModule, AuthModule],
  controllers: [ControlsController],
  providers: [ControlsService],
  exports: [ControlsService],
})
export class ControlsModule {}
