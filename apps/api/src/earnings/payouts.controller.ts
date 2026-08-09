import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { payoutRequestSchema, Role, type JwtPayload, type PayoutRequestInput } from '@botparty/shared';
import { PayoutsService } from './payouts.service';
import { MarkPaidPayoutDto, RejectPayoutDto } from './payouts.dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@ApiTags('payouts')
@Controller('payouts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a payout request' })
  async create(@CurrentUser() user: JwtPayload, @Body(new ZodValidationPipe(payoutRequestSchema)) dto: PayoutRequestInput) {
    return this.payouts.createRequest({
      userId: user.sub,
      amount: dto.amount,
      destination: dto.destination,
      destinationType: dto.destinationType,
      ...(dto.notes === undefined ? {} : { notes: dto.notes }),
    });
  }

  @Get()
  @ApiOperation({ summary: 'List my payout requests' })
  async list(@CurrentUser() user: JwtPayload) {
    return { items: await this.payouts.listForUser(user.sub) };
  }

  @Get('review')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List pending payout requests (staff)' })
  async listReview(@CurrentUser() user: JwtPayload) {
    this.assertFinance(user);
    return { items: await this.payouts.listForReview() };
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve a payout request (staff)' })
  async approve(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    this.assertFinance(user);
    return this.payouts.approve(id, user.sub);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reject a payout request (staff)' })
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayoutDto,
  ) {
    this.assertFinance(user);
    return this.payouts.reject(id, user.sub, dto.reason);
  }

  @Post(':id/mark-paid')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mark approved payout as paid and debit wallet (staff)' })
  async markPaid(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidPayoutDto,
  ) {
    this.assertFinance(user);
    return this.payouts.markPaid(id, user.sub, dto.providerRef);
  }

  @Get(':id/destination')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reveal an approved payout destination to the independent payer' })
  revealDestination(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    this.assertFinance(user);
    return this.payouts.revealDestination(id, user.sub);
  }

  private assertFinance(user: JwtPayload) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Finance access required');
    }
  }
}
