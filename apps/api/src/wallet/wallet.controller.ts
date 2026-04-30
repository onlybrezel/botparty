import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TransactionType } from '@botparty/prisma';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { WalletService } from './wallet.service';
import { DonationService } from './donation.service';
import { DonationDto, ListTransactionsQueryDto } from './wallet.dto';

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
      limit: query.limit,
      cursor: query.cursor,
      type,
    });
  }

  @Post('donations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Donate credits to a robot owner' })
  async donate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DonationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ) {
    return this.donations.donate({
      donorId: user.sub,
      robotId: dto.robotId,
      amount: dto.amount,
      message: dto.message,
      idempotencyKey: idempotencyKey?.slice(0, 128),
      requestMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent']?.toString().slice(0, 255),
      },
    });
  }
}
