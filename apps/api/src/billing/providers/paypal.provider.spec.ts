import { BadRequestException } from '@nestjs/common';
import { PaypalProvider } from './paypal.provider';

const intent = {
  id: 'intent-1',
  userId: 'user-1',
  amountCents: 499,
  creditsAmount: 500,
  currency: 'EUR',
  packageId: 'credits-500',
};

function provider(values: Record<string, string | undefined> = {}) {
  return new PaypalProvider({ get: jest.fn((key: string) => values[key]) });
}

function jsonResponse(value: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    headers: { get: jest.fn().mockReturnValue(null) },
    json: jest.fn().mockResolvedValue(value),
    text: jest.fn().mockResolvedValue(JSON.stringify(value)),
  };
}

describe('PaypalProvider', () => {
  const originalFetch = global.fetch;
  const configured = {
    PAYPAL_CLIENT_ID: 'client-id',
    PAYPAL_CLIENT_SECRET: 'client-secret',
    PAYPAL_WEBHOOK_ID: 'webhook-id',
    PAYPAL_ENV: 'sandbox',
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails closed when PayPal credentials or recurring capabilities are unavailable', async () => {
    const paypal = provider();

    await expect(
      paypal.createCheckout({
        intent: intent,
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(paypal.verifyWebhook(Buffer.from('{}'), {})).rejects.toThrow(
      'PayPal webhook is not configured',
    );
    await expect(paypal.createSubscriptionCheckout()).rejects.toThrow(
      'PayPal recurring subscriptions are not yet supported',
    );
    await expect(paypal.createBillingPortalSession()).rejects.toThrow(
      'PayPal billing portal is not yet supported',
    );
  });

  it('creates a CAPTURE order and reuses its short-lived access token', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'order-1',
          links: [{ rel: 'approve', href: 'https://paypal.test/approve/order-1' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'order-2',
          links: [{ rel: 'payer-action', href: 'https://paypal.test/approve/order-2' }],
        }),
      );
    const paypal = provider(configured);

    await expect(
      paypal.createCheckout({
        intent: intent,
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
      }),
    ).resolves.toEqual({
      intentId: 'intent-1',
      providerRef: 'order-1',
      redirectUrl: 'https://paypal.test/approve/order-1',
    });
    await paypal.createCheckout({
      intent: { ...intent, id: 'intent-2' },
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api-m.sandbox.paypal.com/v2/checkout/orders',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces provider authentication and order creation failures without a checkout', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      provider(configured).createCheckout({
        intent: intent,
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
      }),
    ).rejects.toThrow('PayPal auth failed');

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid order' }, false));
    await expect(
      provider(configured).createCheckout({
        intent: intent,
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
      }),
    ).rejects.toThrow('PayPal order creation failed');
  });

  it('verifies webhook signatures before mapping captures', async () => {
    const event = {
      id: 'event-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'capture-1',
        custom_id: 'intent-1',
        amount: { value: '4.99', currency_code: 'eur' },
        supplementary_data: { related_ids: { order_id: 'order-1' } },
      },
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ verification_status: 'SUCCESS' }));

    await expect(
      provider(configured).verifyWebhook(Buffer.from(JSON.stringify(event)), {
        'paypal-transmission-id': 'transmission-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        eventId: 'event-1',
        type: 'completed',
        intentId: 'intent-1',
        providerRef: 'order-1',
        paymentRef: 'capture-1',
        amountCents: 499,
        currency: 'EUR',
      }),
    );
  });

  it('rejects a webhook whose provider signature is not verified', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ verification_status: 'FAILURE' }));

    await expect(
      provider(configured).verifyWebhook(
        Buffer.from(JSON.stringify({ id: 'event-1', event_type: 'unknown', resource: {} })),
        {},
      ),
    ).rejects.toThrow('PayPal webhook signature verification failed');
  });

  it.each([
    ['CHECKOUT.ORDER.APPROVED', 'approved'],
    ['PAYMENT.CAPTURE.DENIED', 'failed'],
    ['CHECKOUT.ORDER.VOIDED', 'failed'],
    ['PAYMENT.CAPTURE.REFUNDED', 'refunded'],
    ['CUSTOMER.DISPUTE.CREATED', 'chargeback'],
    ['CUSTOMER.DISPUTE.RESOLVED', 'chargeback'],
    ['SOMETHING.NEW', 'unknown'],
  ])('maps stored %s events to %s', (eventType, expectedType) => {
    const parsed = provider(configured).parseStoredWebhookEvent({
      eventId: 'event-1',
      eventType,
      payload: {
        id: 'event-1',
        event_type: eventType,
        resource: {
          id: 'resource-1',
          purchase_units: [{ custom_id: 'intent-1' }],
          gross_amount: { value: '1.25', currency_code: 'usd' },
          supplementary_data: { related_ids: { capture_id: 'capture-1' } },
        },
      },
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        type: expectedType,
        intentId: 'intent-1',
        amountCents: 125,
        currency: 'USD',
      }),
    );
  });

  it('ignores malformed stored webhook payloads', () => {
    const paypal = provider(configured);
    expect(
      paypal.parseStoredWebhookEvent({ eventId: 'event-1', eventType: 'event', payload: null }),
    ).toBeNull();
    expect(
      paypal.parseStoredWebhookEvent({ eventId: 'event-1', eventType: 'event', payload: {} }),
    ).toBeNull();
  });

  it('captures approved orders server-side and requires a completed capture', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'order-1',
          purchase_units: [
            {
              custom_id: 'intent-1',
              payments: {
                captures: [
                  {
                    id: 'capture-1',
                    status: 'COMPLETED',
                    amount: { value: '4.99', currency_code: 'eur' },
                  },
                ],
              },
            },
          ],
        }),
      );

    await expect(provider(configured).captureApprovedOrder('order-1', 'intent-1')).resolves.toEqual(
      expect.objectContaining({
        type: 'completed',
        providerRef: 'order-1',
        paymentRef: 'capture-1',
        amountCents: 499,
      }),
    );

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'order-2', purchase_units: [] }));
    await expect(provider(configured).captureApprovedOrder('order-2', 'intent-1')).rejects.toThrow(
      'PayPal capture was not completed',
    );
  });

  it('retries a transient provider response before succeeding', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'order-1', purchase_units: [] }));

    await expect(
      provider({ ...configured, PAYPAL_RETRY_BASE_MS: '10' }).captureApprovedOrder('order-1', 'intent-1'),
    ).rejects.toThrow('PayPal capture was not completed');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('fails predictably after a bounded network timeout sequence', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    await expect(
      provider({ ...configured, PAYPAL_MAX_RETRIES: '1', PAYPAL_RETRY_BASE_MS: '10' }).createCheckout({
        intent: intent,
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
      }),
    ).rejects.toMatchObject({ status: 503, message: 'PayPal is temporarily unavailable' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid webhook JSON before contacting PayPal', async () => {
    global.fetch = jest.fn();

    await expect(provider(configured).verifyWebhook(Buffer.from('{'), {})).rejects.toThrow(
      'PayPal webhook payload is invalid JSON',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
