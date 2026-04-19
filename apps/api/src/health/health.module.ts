import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  controllers: [HealthController],
})
export class HealthModule {}
