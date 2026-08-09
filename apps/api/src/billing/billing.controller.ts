import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { checkoutRequestSchema, Role, type CheckoutRequest, type JwtPayload } from '@botparty/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

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

  @Get('subscription-plans')
  @Public()
  @ApiOperation({ summary: 'List available subscription plans' })
  listSubscriptionPlans() {
    return { plans: this.billing.listSubscriptionPlans() };
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a credit purchase checkout session' })
  async checkout(@CurrentUser() user: JwtPayload, @Body(new ZodValidationPipe(checkoutRequestSchema)) dto: CheckoutRequest) {
    return this.billing.createCheckout({
      userId: user.sub,
      provider: dto.provider,
      packageId: dto.packageId,
      ...(dto.successUrl === undefined ? {} : { successUrl: dto.successUrl }),
      ...(dto.cancelUrl === undefined ? {} : { cancelUrl: dto.cancelUrl }),
      termsVersion: dto.termsVersion,
      immediateDeliveryConsent: dto.immediateDeliveryConsent,
    });
  }

  @Get('admin/webhook-events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List billing webhook events for staff review' })
  listWebhookEvents() {
    return this.billing.listWebhookEvents();
  }

  @Post('admin/webhook-events/:eventId/replay')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replay a stored billing webhook event' })
  replayWebhookEvent(@Param('eventId') eventId: string) {
    return this.billing.replayWebhookEvent(eventId);
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
