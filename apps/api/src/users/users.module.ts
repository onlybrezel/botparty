import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { WalletModule } from '../wallet/wallet.module';
import { UserAvatarService } from './user-avatar.service';
import { StorageDeletionModule } from '../storage/storage-deletion.module';

@Module({
  imports: [WalletModule, StorageDeletionModule],
  providers: [UsersService, UserAvatarService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
