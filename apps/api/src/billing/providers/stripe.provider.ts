import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeSDK from 'stripe';
import type { CheckoutBillingIntent, CheckoutSession, PaymentProvider, VerifiedWebhookEvent } from './payment-provider.interface';

interface StripeConfig {
  get(key: string): string | undefined;
}

type StripeClient = InstanceType<typeof StripeSDK>;

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  payment_status?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  currency?: string | null;
  subscription?: string | null;
  payment_intent?: string | { id?: string } | null;
  customer?: string | { id?: string } | null;
  mode?: string | null;
};

type StripeCharge = {
  id: string;
  amount_refunded: number;
  currency: string | null;
  payment_intent?: string | { id?: string } | null;
};

type StripeDispute = {
  status: string;
  amount: number;
  currency: string | null;
};

type StripeEventShape = {
  id: string;
  type: string;
  data: {
    object: unknown;
  };
};

type StripeInvoice = {
  id: string;
  subscription?: string | null;
  customer?: string | { id?: string } | null;
  amount_paid?: number | null;
  currency?: string | null;
  billing_reason?: string | null;
};

type StripeSubscription = {
  id: string;
  customer?: string | { id?: string } | null;
  status?: string | null;
};

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly capabilities = {
    recurringCheckout: true,
    billingPortal: true,
  } as const;
  private readonly logger = new Logger(StripeProvider.name);
  private readonly client: StripeClient | null;
  private readonly webhookSecret: string | null;

  constructor(@Inject(ConfigService) private readonly config: StripeConfig) {
    const key = this.config.get('STRIPE_SECRET_KEY');
    this.client = key
      ? new StripeSDK(key, { apiVersion: '2026-04-22.dahlia' })
      : null;
    this.webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET') ?? null;
    if (!this.client) {
      this.logger.warn('Stripe disabled: STRIPE_SECRET_KEY not set');
    }
  }

  async createCheckout(input: {
    intent: CheckoutBillingIntent;
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

  async createSubscriptionCheckout(input: {
    intent: CheckoutBillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    if (!this.client) {
      throw new BadRequestException('Stripe is not configured');
    }
    const { intent, successUrl, cancelUrl } = input;
    const session = (await this.client.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      client_reference_id: intent.id,
      metadata: {
        intentId: intent.id,
        userId: intent.userId,
        packageId: intent.packageId,
        creditsAmount: String(intent.creditsAmount),
        purchaseType: 'SUBSCRIPTION',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: intent.currency.toLowerCase(),
            unit_amount: intent.amountCents,
            recurring: {
              interval: 'month',
            },
            product_data: {
              name: `${intent.creditsAmount} BotParty credits/month`,
            },
          },
        },
      ],
    })) as StripeCheckoutSession;
    return {
      intentId: intent.id,
      providerRef: session.subscription ?? session.id,
      redirectUrl: session.url ?? '',
    };
  }

  async createBillingPortalSession(input: {
    customerRef: string;
    returnUrl: string;
  }): Promise<{ redirectUrl: string }> {
    if (!this.client) {
      throw new BadRequestException('Stripe is not configured');
    }
    const session = await this.client.billingPortal.sessions.create({
      customer: input.customerRef,
      return_url: input.returnUrl,
    });
    return {
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
    return this.parseEvent(event as StripeEventShape);
  }

  parseStoredWebhookEvent(record: { eventId: string; eventType: string; payload: unknown }): VerifiedWebhookEvent | null {
    if (!record.payload || typeof record.payload !== 'object') {
      return null;
    }
    const payload = record.payload as Partial<StripeEventShape>;
    if (!payload.id || !payload.type || !payload.data || typeof payload.data !== 'object') {
      return null;
    }
    return this.parseEvent(payload as StripeEventShape);
  }

  private parseEvent(event: StripeEventShape): VerifiedWebhookEvent {
    let type: VerifiedWebhookEvent['type'] = 'unknown';
    let intentId: string | null = null;
    let providerRef = event.id;
    let paymentRef: string | null = null;
    let subscriptionRef: string | null = null;
    const relatedProviderRef: string | null = null;
    let customerRef: string | null = null;
    let amountCents = 0;
    let currency = 'eur';

    switch (event.type) {
      case 'checkout.session.completed': {
        const obj = event.data.object as StripeCheckoutSession;
        const isSubscription = obj.mode === 'subscription' || Boolean(obj.subscription);
        type = obj.payment_status === 'paid' || isSubscription ? 'completed' : 'failed';
        intentId = obj.client_reference_id ?? obj.metadata?.['intentId'] ?? null;
        providerRef = obj.subscription ?? obj.id;
        subscriptionRef = obj.subscription ?? null;
        paymentRef =
          typeof obj.payment_intent === 'string'
            ? obj.payment_intent
            : obj.payment_intent?.id ?? null;
        customerRef =
          typeof obj.customer === 'string'
            ? obj.customer
            : obj.customer?.id ?? null;
        amountCents = obj.amount_total ?? 0;
        currency = (obj.currency ?? 'eur').toUpperCase();
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const obj = event.data.object as StripeInvoice;
        type = 'completed';
        intentId = null;
        providerRef = obj.subscription ?? event.id;
        subscriptionRef = obj.subscription ?? null;
        customerRef =
          typeof obj.customer === 'string'
            ? obj.customer
            : obj.customer?.id ?? null;
        amountCents = obj.amount_paid ?? 0;
        currency = (obj.currency ?? 'eur').toUpperCase();
        break;
      }
      case 'customer.subscription.deleted': {
        const obj = event.data.object as StripeSubscription;
        type = 'canceled';
        intentId = null;
        providerRef = obj.id;
        paymentRef = obj.id;
        customerRef =
          typeof obj.customer === 'string'
            ? obj.customer
            : obj.customer?.id ?? null;
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const obj = event.data.object as StripeCheckoutSession;
        type = 'failed';
        intentId = obj.client_reference_id ?? obj.metadata?.['intentId'] ?? null;
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
      paymentRef,
      subscriptionRef,
      relatedProviderRef,
      customerRef,
      amountCents,
      currency: currency.toUpperCase(),
      rawPayload: event,
    };
  }
}
