import { StripeProvider } from './stripe.provider';

function provider() {
  return new StripeProvider({ get: jest.fn().mockReturnValue(undefined) } as never);
}

describe('StripeProvider', () => {
  it('fails closed for every provider operation when Stripe is not configured', async () => {
    const stripe = provider();
    const input = {
      intent: {
        id: 'intent-1',
        userId: 'user-1',
        amountCents: 499,
        creditsAmount: 500,
        currency: 'EUR',
        packageId: 'credits-500',
      } as never,
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
    };

    await expect(stripe.createCheckout(input)).rejects.toThrow('Stripe is not configured');
    await expect(stripe.createSubscriptionCheckout(input)).rejects.toThrow(
      'Stripe is not configured',
    );
    await expect(
      stripe.createBillingPortalSession({
        customerRef: 'customer-1',
        returnUrl: 'https://example.test/account',
      }),
    ).rejects.toThrow('Stripe is not configured');
    await expect(stripe.verifyWebhook(Buffer.from('{}'), {})).rejects.toThrow(
      'Stripe webhook is not configured',
    );
  });

  it.each([
    [
      'checkout.session.completed',
      {
        id: 'session-1',
        payment_status: 'paid',
        client_reference_id: 'intent-1',
        payment_intent: { id: 'payment-1' },
        customer: { id: 'customer-1' },
        amount_total: 499,
        currency: 'eur',
      },
      'completed',
    ],
    [
      'invoice.paid',
      {
        id: 'invoice-1',
        subscription: 'subscription-1',
        customer: 'customer-1',
        amount_paid: 499,
        currency: 'usd',
      },
      'completed',
    ],
    [
      'invoice.payment_succeeded',
      { id: 'invoice-2', subscription: null, amount_paid: null, currency: null },
      'completed',
    ],
    [
      'customer.subscription.deleted',
      { id: 'subscription-1', customer: { id: 'customer-1' } },
      'canceled',
    ],
    [
      'checkout.session.async_payment_failed',
      { id: 'session-2', metadata: { intentId: 'intent-2' } },
      'failed',
    ],
    ['checkout.session.expired', { id: 'session-3' }, 'failed'],
    ['charge.refunded', { id: 'charge-1', amount_refunded: 250, currency: 'eur' }, 'refunded'],
    ['charge.dispute.closed', { status: 'lost', amount: 499, currency: 'eur' }, 'chargeback'],
    ['new.provider.event', { id: 'object-1' }, 'unknown'],
  ])('maps stored %s events', (type, object, expectedType) => {
    const parsed = provider().parseStoredWebhookEvent({
      eventId: 'event-1',
      eventType: type,
      payload: { id: 'event-1', type, data: { object } },
    });

    expect(parsed).toEqual(expect.objectContaining({ eventId: 'event-1', type: expectedType }));
  });

  it('ignores malformed stored webhook payloads', () => {
    const stripe = provider();
    expect(
      stripe.parseStoredWebhookEvent({ eventId: 'event-1', eventType: 'event', payload: null }),
    ).toBeNull();
    expect(
      stripe.parseStoredWebhookEvent({ eventId: 'event-1', eventType: 'event', payload: {} }),
    ).toBeNull();
  });
});
