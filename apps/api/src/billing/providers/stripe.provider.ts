import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeSDK from 'stripe';
import type { BillingIntent } from '@botparty/prisma';
import type { CheckoutSession, PaymentProvider, VerifiedWebhookEvent } from './payment-provider.interface';

type StripeClient = InstanceType<typeof StripeSDK>;

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  payment_status?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  currency?: string | null;
};

type StripeCharge = {
  id: string;
  amount_refunded: number;
  currency: string | null;
};

type StripeDispute = {
  status: string;
  amount: number;
  currency: string | null;
};

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly logger = new Logger(StripeProvider.name);
  private readonly client: StripeClient | null;
  private readonly webhookSecret: string | null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.client = key
      ? new StripeSDK(key, { apiVersion: '2024-11-20.acacia' as never })
      : null;
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? null;
    if (!this.client) {
      this.logger.warn('Stripe disabled: STRIPE_SECRET_KEY not set');
    }
  }

  async createCheckout(input: {
    intent: BillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    if (!this.client) {
      throw new BadRequestException('Stripe is not configured');
    }
    const { intent, successUrl, cancelUrl } = input;
    const session = (await this.client.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      client_reference_id: intent.id,
      metadata: {
        intentId: intent.id,
        userId: intent.userId,
        creditsAmount: String(intent.creditsAmount),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: intent.currency.toLowerCase(),
            unit_amount: intent.amountCents,
            product_data: {
              name: `${intent.creditsAmount} BotParty credits`,
            },
          },
        },
      ],
    })) as StripeCheckoutSession;
    return {
      intentId: intent.id,
      providerRef: session.id,
      redirectUrl: session.url ?? '',
    };
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedWebhookEvent> {
    if (!this.client || !this.webhookSecret) {
      throw new BadRequestException('Stripe webhook is not configured');
    }
    const sig = (headers['stripe-signature'] ?? '') as string;
    const event = this.client.webhooks.constructEvent(rawBody, sig, this.webhookSecret);

    let type: VerifiedWebhookEvent['type'] = 'unknown';
    let intentId: string | null = null;
    let providerRef = event.id;
    let amountCents = 0;
    let currency = 'eur';

    switch (event.type) {
      case 'checkout.session.completed': {
        const obj = event.data.object as StripeCheckoutSession;
        type = obj.payment_status === 'paid' ? 'completed' : 'failed';
        intentId = obj.client_reference_id ?? obj.metadata?.intentId ?? null;
        providerRef = obj.id;
        amountCents = obj.amount_total ?? 0;
        currency = (obj.currency ?? 'eur').toUpperCase();
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const obj = event.data.object as StripeCheckoutSession;
        type = 'failed';
        intentId = obj.client_reference_id ?? obj.metadata?.intentId ?? null;
        providerRef = obj.id;
        break;
      }
      case 'charge.refunded': {
        const obj = event.data.object as StripeCharge;
        type = 'refunded';
        providerRef = obj.id;
        amountCents = obj.amount_refunded;
        currency = (obj.currency ?? 'eur').toUpperCase();
        break;
      }
      case 'charge.dispute.closed': {
        const obj = event.data.object as StripeDispute;
        if (obj.status === 'lost') {
          type = 'chargeback';
        }
        amountCents = obj.amount;
        currency = (obj.currency ?? 'eur').toUpperCase();
        break;
      }
      default:
        type = 'unknown';
    }

    return {
      eventId: event.id,
      type,
      intentId,
      providerRef,
      amountCents,
      currency: currency.toUpperCase(),
      rawPayload: event,
    };
  }
}
