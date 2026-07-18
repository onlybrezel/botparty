import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageDeletionService } from './storage-deletion.service';

@Module({
  imports: [PrismaModule],
  providers: [StorageDeletionService],
  exports: [StorageDeletionService],
})
export class StorageDeletionModule {}
