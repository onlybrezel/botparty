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
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { BillingService } from './billing.service';
import { CheckoutDto } from './billing.dto';

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
  async stripeWebhook(@Req() req: Request, @Headers() headers: Record<string, string | string[] | undefined>) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    return this.billing.handleStripeWebhook(rawBody, headers);
  }

  @Post('webhooks/paypal')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'PayPal webhook receiver' })
  async paypalWebhook(@Req() req: Request, @Headers() headers: Record<string, string | string[] | undefined>) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    return this.billing.handlePaypalWebhook(rawBody, headers);
  }
}
