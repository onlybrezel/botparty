import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PlatformUserService } from './platform-user.service';
import { DonationService } from './donation.service';

@Module({
  providers: [WalletService, PlatformUserService, DonationService],
  controllers: [WalletController],
  exports: [WalletService, PlatformUserService, DonationService],
})
export class WalletModule {}
