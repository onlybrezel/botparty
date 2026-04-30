import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { BillingService } from './billing.service';
import { CheckoutDto } from './billing.dto';

type FastifyRequestWithRawBody = FastifyRequest & { rawBody?: Buffer | string };

function extractRawBody(req: FastifyRequestWithRawBody): Buffer {
  const raw = req.rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string') return Buffer.from(raw);
  return Buffer.from('');
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('packages')
  @Public()
  @ApiOperation({ summary: 'List available credit packages' })
  listPackages() {
    return { packages: this.billing.listPackages() };
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a credit purchase checkout session' })
  async checkout(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutDto) {
    return this.billing.createCheckout({
      userId: user.sub,
      provider: dto.provider,
      packageId: dto.packageId,
    });
  }

  @Post('webhooks/stripe')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook receiver' })
  async stripeWebhook(
    @Req() req: FastifyRequestWithRawBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.billing.handleStripeWebhook(extractRawBody(req), headers);
  }

  @Post('webhooks/paypal')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'PayPal webhook receiver' })
  async paypalWebhook(
    @Req() req: FastifyRequestWithRawBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.billing.handlePaypalWebhook(extractRawBody(req), headers);
  }
}
