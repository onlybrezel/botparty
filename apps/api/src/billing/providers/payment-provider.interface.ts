import type { BillingIntent } from '@botparty/prisma';

export interface CheckoutSession {
  intentId: string;
  redirectUrl: string;
  providerRef: string;
}

export interface VerifiedWebhookEvent {
  eventId: string;
  type: 'completed' | 'failed' | 'refunded' | 'chargeback' | 'unknown';
  intentId: string | null;
  providerRef: string;
  amountCents: number;
  currency: string;
  rawPayload: unknown;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'paypal';
  createCheckout(input: {
    intent: BillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<VerifiedWebhookEvent>;
}
