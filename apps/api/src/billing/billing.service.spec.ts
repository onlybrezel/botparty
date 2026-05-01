import { BillingIntentStatus, TransactionType } from '@botparty/prisma';
import { BillingService } from './billing.service';
import type { VerifiedWebhookEvent } from './providers/payment-provider.interface';

describe('BillingService', () => {
  const intent = {
    id: 'intent-1',
    userId: 'user-1',
    provider: 'stripe',
    providerRef: 'provider-ref-1',
    packageId: 'starter',
    amountCents: 1000,
    currency: 'EUR',
    creditsAmount: 100,
    status: BillingIntentStatus.PENDING,
  };

  function build() {
    const txBillingIntentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txBillingWebhookCreate = jest.fn().mockResolvedValue({ id: 'event-row-1' });
    const prisma = {
      billingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'event-row-1' }),
      },
      billingIntent: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        billingIntent: {
          updateMany: txBillingIntentUpdateMany,
        },
        billingWebhookEvent: {
          create: txBillingWebhookCreate,
        },
      })),
    };

    const wallet = {
      credit: jest.fn().mockResolvedValue(undefined),
      debit: jest.fn().mockResolvedValue(undefined),
    };

    const stripe = {
      name: 'stripe' as const,
      createCheckout: jest.fn(),
      verifyWebhook: jest.fn(),
      parseStoredWebhookEvent: jest.fn(),
    };

    const paypal = {
      name: 'paypal' as const,
      createCheckout: jest.fn(),
      verifyWebhook: jest.fn(),
      parseStoredWebhookEvent: jest.fn(),
    };

    const config = {
      get: jest.fn(),
    };

    return {
      service: new BillingService(prisma as never, wallet as never, stripe as never, paypal as never, config as never),
      prisma,
      txBillingIntentUpdateMany,
      txBillingWebhookCreate,
      wallet,
      stripe,
      paypal,
    };
  }

  function makeEvent(overrides: Partial<VerifiedWebhookEvent> = {}): VerifiedWebhookEvent {
    return {
      eventId: 'evt-1',
      type: 'completed',
      intentId: intent.id,
      providerRef: 'provider-ref-1',
      customerRef: null,
      amountCents: intent.amountCents,
      currency: intent.currency,
      rawPayload: { id: 'evt-1' },
      ...overrides,
    };
  }

  it('credits a settled Stripe checkout only once when the webhook is replayed', async () => {
    const { service, prisma, wallet, stripe } = build();
    prisma.billingIntent.findUnique
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...intent, status: BillingIntentStatus.PAID });
    stripe.verifyWebhook.mockResolvedValue(makeEvent());

    await expect(service.handleStripeWebhook(Buffer.from('stripe'), {})).resolves.toEqual({ status: 'credited' });
    expect(wallet.credit).toHaveBeenCalledWith(
      intent.userId,
      intent.creditsAmount,
      TransactionType.DEPOSIT,
      expect.objectContaining({
        metadata: expect.objectContaining({ billingIntentId: intent.id, provider: 'stripe' }),
      }),
    );

    prisma.billingWebhookEvent.findUnique.mockResolvedValue({ id: 'duplicate-row' });
    await expect(service.handleStripeWebhook(Buffer.from('stripe'), {})).resolves.toEqual({ status: 'duplicate' });
    expect(wallet.credit).toHaveBeenCalledTimes(1);
  });

  it('marks a PayPal refund and debits the credited balance', async () => {
    const { service, prisma, wallet, paypal } = build();
    paypal.verifyWebhook.mockResolvedValue(makeEvent({ eventId: 'paypal-refund', type: 'refunded' }));

    await expect(service.handlePaypalWebhook(Buffer.from('paypal'), {})).resolves.toEqual({ status: 'refunded' });

    expect(prisma.billingIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: intent.id },
        data: expect.objectContaining({ status: BillingIntentStatus.REFUNDED }),
      }),
    );
    expect(wallet.debit).toHaveBeenCalledWith(
      intent.userId,
      intent.creditsAmount,
      TransactionType.REFUND,
      expect.objectContaining({
        metadata: expect.objectContaining({ billingIntentId: intent.id, provider: 'paypal' }),
      }),
    );
  });

  it('marks a chargeback and debits the credited balance', async () => {
    const { service, prisma, wallet, paypal } = build();
    paypal.verifyWebhook.mockResolvedValue(makeEvent({ eventId: 'paypal-chargeback', type: 'chargeback' }));

    await expect(service.handlePaypalWebhook(Buffer.from('paypal'), {})).resolves.toEqual({ status: 'chargeback' });

    expect(prisma.billingIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: intent.id },
        data: expect.objectContaining({ status: BillingIntentStatus.CHARGEBACK }),
      }),
    );
    expect(wallet.debit).toHaveBeenCalledWith(
      intent.userId,
      intent.creditsAmount,
      TransactionType.CHARGEBACK,
      expect.objectContaining({
        metadata: expect.objectContaining({ billingIntentId: intent.id, provider: 'paypal' }),
      }),
    );
  });

  it('replays a stored webhook with a synthetic persisted event id', async () => {
    const { service, prisma, wallet, stripe, txBillingWebhookCreate } = build();
    prisma.billingWebhookEvent.findUnique.mockResolvedValueOnce({
      id: 'stored-event-1',
      provider: 'stripe',
      eventId: 'evt-1',
      eventType: 'completed',
      payload: { id: 'evt-1' },
    });
    prisma.billingIntent.findUnique
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...intent, status: BillingIntentStatus.PAID });
    stripe.parseStoredWebhookEvent.mockReturnValue(makeEvent());

    await expect(service.replayWebhookEvent('stored-event-1')).resolves.toEqual({ status: 'credited' });

    expect(stripe.parseStoredWebhookEvent).toHaveBeenCalled();
    expect(txBillingWebhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: expect.stringMatching(/^evt-1:replay:stored-event-1:/),
        }),
      }),
    );
    expect(wallet.credit).toHaveBeenCalledTimes(1);
  });
});
