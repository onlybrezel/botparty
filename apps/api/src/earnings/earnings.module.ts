import { Module } from '@nestjs/common';
import { EarningsService } from './earnings.service';
import { EarningsController } from './earnings.controller';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [EarningsService, PayoutsService],
  controllers: [EarningsController, PayoutsController],
  exports: [EarningsService, PayoutsService],
})
export class EarningsModule {}
