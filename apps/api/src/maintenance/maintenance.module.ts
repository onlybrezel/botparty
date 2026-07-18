import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenanceService } from './maintenance.service';
import { RedisModule } from '../redis/redis.module';
import { StorageDeletionModule } from '../storage/storage-deletion.module';

@Module({
  imports: [PrismaModule, RedisModule, StorageDeletionModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
