import type { BillingIntent } from '@botparty/prisma';

export interface CheckoutSession {
  intentId: string;
  redirectUrl: string;
  providerRef: string;
}

export interface VerifiedWebhookEvent {
  eventId: string;
  type: 'approved' | 'completed' | 'failed' | 'refunded' | 'chargeback' | 'canceled' | 'unknown';
  intentId: string | null;
  providerRef: string;
  paymentRef: string | null;
  subscriptionRef: string | null;
  relatedProviderRef: string | null;
  customerRef: string | null;
  amountCents: number;
  currency: string;
  rawPayload: unknown;
}

export interface ProviderCapabilities {
  recurringCheckout: boolean;
  billingPortal: boolean;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'paypal';
  readonly capabilities: ProviderCapabilities;
  createCheckout(input: {
    intent: BillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  createSubscriptionCheckout(input: {
    intent: BillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  createBillingPortalSession(input: {
    customerRef: string;
    returnUrl: string;
  }): Promise<{ redirectUrl: string }>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<VerifiedWebhookEvent>;
  parseStoredWebhookEvent(record: {
    eventId: string;
    eventType: string;
    payload: unknown;
  }): VerifiedWebhookEvent | null;
}
