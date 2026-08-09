import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionType } from '@botparty/prisma';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { donationRequestSchema, type DonationRequest, type JwtPayload } from '@botparty/shared';
import { WalletService } from './wallet.service';
import { DonationService } from './donation.service';
import { ListTransactionsQueryDto } from './wallet.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Throttle } from '@nestjs/throttler';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly donations: DonationService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current wallet summary (balance + recent transactions)' })
  async getMe(@CurrentUser() user: JwtPayload) {
    const [balance, recent] = await Promise.all([
      this.wallet.getBalance(user.sub),
      this.wallet.listTransactions(user.sub, { limit: 20 }),
    ]);
    return {
      balance,
      recentTransactions: recent.items,
    };
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List wallet transactions (cursor-paginated)' })
  async listTransactions(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListTransactionsQueryDto,
  ) {
    const type = query.type && Object.values(TransactionType).includes(query.type as TransactionType)
      ? (query.type as TransactionType)
      : undefined;
    return this.wallet.listTransactions(user.sub, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(type === undefined ? {} : { type }),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(query.robotId === undefined ? {} : { robotId: query.robotId }),
    });
  }

  @Get('transactions/export')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export the complete filtered wallet ledger' })
  async exportTransactions(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListTransactionsQueryDto,
  ) {
    const type = query.type && Object.values(TransactionType).includes(query.type as TransactionType)
      ? (query.type as TransactionType)
      : undefined;
    return {
      exportedAt: new Date().toISOString(),
      items: await this.wallet.exportTransactions(user.sub, {
        ...(type === undefined ? {} : { type }),
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
        ...(query.robotId === undefined ? {} : { robotId: query.robotId }),
      }),
    };
  }

  @Post('donations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Donate credits to a robot owner' })
  async donate(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(donationRequestSchema)) dto: DonationRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.donations.donate({
      donorId: user.sub,
      robotId: dto.robotId,
      amount: dto.amount,
      ...(dto.message === undefined ? {} : { message: dto.message }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey: idempotencyKey.slice(0, 128) }),
    });
  }
}
