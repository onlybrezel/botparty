import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingIntentStatus, TransactionType } from '@botparty/prisma';
import { BillingService } from './billing.service';
import type { VerifiedWebhookEvent } from './providers/payment-provider.interface';

describe('BillingService', () => {
  const intent = {
    id: '00000000-0000-0000-0000-000000000011',
    userId: 'user-1',
    provider: 'stripe',
    providerRef: 'provider-ref-1',
    providerPaymentRef: null,
    providerSubscriptionRef: null,
    providerCustomerRef: null,
    packageId: 'starter',
    amountCents: 499,
    currency: 'EUR',
    creditsAmount: 500,
    reversedCredits: 0,
    paidAt: null,
    status: BillingIntentStatus.PENDING as BillingIntentStatus,
  };

  function event(overrides: Partial<VerifiedWebhookEvent> = {}): VerifiedWebhookEvent {
    return {
      eventId: 'evt-1',
      type: 'completed',
      intentId: intent.id,
      providerRef: intent.providerRef,
      paymentRef: null,
      subscriptionRef: null,
      relatedProviderRef: null,
      customerRef: null,
      amountCents: intent.amountCents,
      currency: intent.currency,
      rawPayload: { id: 'evt-1' },
      ...overrides,
    };
  }

  function build(lockedIntent = intent) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      billingIntent: {
        findFirst: jest.fn().mockResolvedValue(lockedIntent),
        findUniqueOrThrow: jest.fn().mockResolvedValue(lockedIntent),
        update: jest.fn().mockResolvedValue(lockedIntent),
      },
      billingWebhookEvent: { create: jest.fn().mockResolvedValue({ id: 'webhook-row' }) },
      transaction: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      billingWebhookEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      billingIntent: {
        create: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue(intent),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const wallet = {
      runSerializable: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      creditInTransaction: jest.fn().mockResolvedValue({ id: 'credit-row' }),
      reverseBillingCreditInTransaction: jest.fn().mockResolvedValue({ id: 'reversal-row' }),
    };
    const stripe = {
      name: 'stripe' as const,
      createCheckout: jest.fn().mockResolvedValue({ providerRef: 'stripe-session', redirectUrl: 'https://stripe.test' }),
      verifyWebhook: jest.fn().mockResolvedValue(event()),
      parseStoredWebhookEvent: jest.fn().mockReturnValue(event()),
    };
    const paypal = {
      name: 'paypal' as const,
      createCheckout: jest.fn().mockResolvedValue({ providerRef: 'paypal-order', redirectUrl: 'https://paypal.test' }),
      verifyWebhook: jest.fn().mockResolvedValue(event()),
      parseStoredWebhookEvent: jest.fn().mockReturnValue(event()),
      captureApprovedOrder: jest.fn().mockResolvedValue(event({ eventId: 'capture-1' })),
    };
    const config = { get: jest.fn().mockReturnValue('https://botparty.test') };
    const features = {
      isEnabled: jest.fn().mockReturnValue(true),
      assertEnabled: jest.fn(),
    };
    const notifications = { publishSafely: jest.fn().mockResolvedValue(null) };
    const service = new BillingService(
      prisma as never,
      wallet as never,
      stripe as never,
      paypal as never,
      config as never,
      features as never,
      notifications as never,
    );
    return { service, tx, prisma, wallet, stripe, paypal, config, features, notifications };
  }

  it('hides packages when billing is disabled and never advertises subscriptions', () => {
    const { service, features } = build();
    expect(service.listPackages()).not.toHaveLength(0);
    features.isEnabled.mockReturnValue(false);
    expect(service.listPackages()).toEqual([]);
    expect(service.listSubscriptionPlans()).toEqual([]);
  });

  it('normalizes stored webhook events for staff review', async () => {
    const { service, prisma, stripe } = build();
    prisma.billingWebhookEvent.findMany.mockResolvedValue([{
      id: 'row-1', provider: 'stripe', eventId: 'evt-1', eventType: 'completed', payload: { ok: true }, processedAt: new Date('2026-07-17T00:00:00Z'),
    }]);
    stripe.parseStoredWebhookEvent.mockReturnValue(event({ currency: undefined, intentId: undefined, providerRef: undefined }));
    await expect(service.listWebhookEvents(999)).resolves.toEqual({ items: [expect.objectContaining({
      id: 'row-1', amountCents: 499, currency: null, processedAt: '2026-07-17T00:00:00.000Z',
    })] });
    expect(prisma.billingWebhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });

  it('returns safe defaults when a stored event cannot be parsed', async () => {
    const { service, prisma, paypal } = build();
    prisma.billingWebhookEvent.findMany.mockResolvedValue([{
      id: 'row-2', provider: 'paypal', eventId: 'evt-2', eventType: 'other', payload: {}, processedAt: new Date(0),
    }]);
    paypal.parseStoredWebhookEvent.mockReturnValue(null);
    await expect(service.listWebhookEvents(0)).resolves.toEqual({ items: [expect.objectContaining({
      intentId: null, providerRef: null, amountCents: 0, currency: null,
    })] });
  });

  it('creates a pending checkout using explicit redirect URLs', async () => {
    const { service, prisma, stripe, features } = build();
    await expect(service.createCheckout({
      userId: 'user-1', provider: 'stripe', packageId: 'starter', successUrl: ' https://ok.test ', cancelUrl: ' https://cancel.test ', termsVersion: '2026-07-17', immediateDeliveryConsent: true,
    })).resolves.toEqual({ intentId: intent.id, provider: 'stripe', redirectUrl: 'https://stripe.test' });
    expect(features.assertEnabled).toHaveBeenCalledWith('BILLING');
    expect(stripe.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ successUrl: 'https://ok.test', cancelUrl: 'https://cancel.test' }));
    expect(prisma.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { providerRef: 'stripe-session', status: BillingIntentStatus.PENDING } }));
  });

  it('uses configured fallback redirects for PayPal', async () => {
    const { service, paypal } = build();
    await service.createCheckout({ userId: 'user-1', provider: 'paypal', packageId: 'starter', termsVersion: 'v1', immediateDeliveryConsent: true });
    expect(paypal.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      successUrl: 'https://botparty.test/wallet?status=success', cancelUrl: 'https://botparty.test/wallet?status=cancelled',
    }));
  });

  it('falls back to the local public URL when none is configured', async () => {
    const { service, stripe, config } = build();
    config.get.mockReturnValue(undefined);
    await service.createCheckout({ userId: 'user-1', provider: 'stripe', packageId: 'starter', termsVersion: 'v1', immediateDeliveryConsent: true });
    expect(stripe.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ successUrl: 'http://localhost:3000/wallet?status=success' }));
  });

  it('marks provider checkout failures without storing the error message', async () => {
    const { service, prisma, stripe } = build();
    stripe.createCheckout.mockRejectedValue(new TypeError('provider secret'));
    await expect(service.createCheckout({ userId: 'user-1', provider: 'stripe', packageId: 'starter', termsVersion: 'v1', immediateDeliveryConsent: true })).rejects.toThrow('provider secret');
    expect(prisma.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: BillingIntentStatus.FAILED, metadata: expect.objectContaining({ checkoutError: 'TypeError' }) }),
    }));
  });

  it.each([
    [{ provider: 'stripe', packageId: 'missing' }, NotFoundException],
    [{ provider: 'other', packageId: 'starter' }, BadRequestException],
  ])('rejects invalid checkout input %#', async (partial, errorType) => {
    const { service } = build();
    await expect(service.createCheckout({ userId: 'user-1', termsVersion: 'v1', immediateDeliveryConsent: true, ...partial })).rejects.toBeInstanceOf(errorType);
  });

  it('keeps subscriptions unavailable', async () => {
    const { service } = build();
    await expect(service.createSubscriptionCheckout({ userId: 'u', provider: 'stripe', planId: 'p' })).rejects.toThrow('Subscriptions are not available');
  });

  it('credits a completed event atomically', async () => {
    const { service, tx, wallet, stripe } = build();
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'credited' });
    expect(stripe.verifyWebhook).toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(wallet.creditInTransaction).toHaveBeenCalledWith(tx, 'user-1', 500, TransactionType.DEPOSIT, expect.any(Object));
    expect(tx.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: BillingIntentStatus.PAID }) }));
  });

  it('does not duplicate an existing credit', async () => {
    const { service, tx, wallet } = build();
    tx.transaction.findUnique.mockResolvedValue({ id: 'credit-existing' });
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'duplicate_credit' });
    expect(wallet.creditInTransaction).not.toHaveBeenCalled();
  });

  it('ignores unknown or unresolved events while retaining their idempotency record', async () => {
    const first = build();
    first.stripe.verifyWebhook.mockResolvedValue(event({ type: 'unknown' }));
    await expect(first.service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'ignored' });
    const second = build();
    second.tx.billingIntent.findFirst.mockResolvedValue(null);
    await expect(second.service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'ignored' });
    expect(second.tx.billingWebhookEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IGNORED', intentId: null }) }));
  });

  it('records PayPal approval before capture and then credits only the capture', async () => {
    const { service, paypal, tx, wallet } = build({ ...intent, provider: 'paypal' });
    paypal.verifyWebhook.mockResolvedValue(event({ type: 'approved' }));
    paypal.captureApprovedOrder.mockResolvedValue(event({ eventId: 'capture', type: 'completed' }));
    await expect(service.handlePaypalWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'credited' });
    expect(paypal.captureApprovedOrder).toHaveBeenCalledWith(intent.providerRef, intent.id);
    expect(tx.billingWebhookEvent.create).toHaveBeenCalledTimes(2);
    expect(wallet.creditInTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not capture non-approved PayPal events or approvals without an intent id', async () => {
    const completed = build({ ...intent, provider: 'paypal' });
    completed.paypal.verifyWebhook.mockResolvedValue(event({ type: 'failed' }));
    await expect(completed.service.handlePaypalWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'failed' });
    expect(completed.paypal.captureApprovedOrder).not.toHaveBeenCalled();

    const missing = build({ ...intent, provider: 'paypal' });
    missing.paypal.verifyWebhook.mockResolvedValue(event({ type: 'approved', intentId: null }));
    await expect(missing.service.handlePaypalWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'approved' });
    expect(missing.paypal.captureApprovedOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', BillingIntentStatus.FAILED],
    ['canceled', BillingIntentStatus.CANCELED],
  ] as const)('transitions a pending event to %s', async (type, status) => {
    const { service, stripe, tx } = build();
    stripe.verifyWebhook.mockResolvedValue(event({ type }));
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: type });
    expect(tx.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status } }));
  });

  it('retains a terminal intent when a late failure arrives', async () => {
    const { service, stripe, tx } = build({ ...intent, status: BillingIntentStatus.PAID });
    stripe.verifyWebhook.mockResolvedValue(event({ type: 'failed' }));
    await service.handleStripeWebhook(Buffer.from('body'), {});
    expect(tx.billingIntent.update).not.toHaveBeenCalled();
  });

  it.each([
    ['refunded', TransactionType.REFUND, BillingIntentStatus.REFUNDED],
    ['chargeback', TransactionType.CHARGEBACK, BillingIntentStatus.CHARGEBACK],
  ] as const)('reverses a full %s exactly once', async (type, transactionType, status) => {
    const { service, stripe, wallet, tx } = build({ ...intent, status: BillingIntentStatus.PAID });
    stripe.verifyWebhook.mockResolvedValue(event({ type, amountCents: 0 }));
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: type, creditsReversed: 500 });
    expect(wallet.reverseBillingCreditInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ type: transactionType, amount: 500 }));
    expect(tx.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status }) }));
  });

  it('rounds a partial refund up and retains paid state', async () => {
    const { service, stripe, tx } = build({ ...intent, status: BillingIntentStatus.PAID });
    stripe.verifyWebhook.mockResolvedValue(event({ type: 'refunded', amountCents: 100 }));
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'refunded', creditsReversed: 101 });
    expect(tx.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reversedCredits: 101, status: BillingIntentStatus.PAID }) }));
  });

  it('treats an exhausted reversal as a duplicate', async () => {
    const { service, stripe, wallet } = build({ ...intent, status: BillingIntentStatus.REFUNDED, reversedCredits: 500 });
    stripe.verifyWebhook.mockResolvedValue(event({ type: 'refunded' }));
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'duplicate_reversal' });
    expect(wallet.reverseBillingCreditInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: 'paypal' }, {}, 'PROVIDER_MISMATCH'],
    [{}, { currency: 'USD' }, 'CURRENCY_MISMATCH'],
    [{}, { amountCents: 1 }, 'AMOUNT_MISMATCH'],
  ])('moves invalid completion to manual review %#', async (intentOverride, eventOverride, reason) => {
    const { service, stripe, tx } = build({ ...intent, ...intentOverride });
    stripe.verifyWebhook.mockResolvedValue(event(eventOverride));
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'needs_review', reason });
    expect(tx.billingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: BillingIntentStatus.NEEDS_REVIEW } }));
  });

  it('rejects a reversal before payment', async () => {
    const { service, stripe } = build();
    stripe.verifyWebhook.mockResolvedValue(event({ type: 'refunded' }));
    await expect(service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'needs_review', reason: 'REVERSAL_BEFORE_PAYMENT' });
  });

  it('maps a unique webhook collision to duplicate and propagates other errors', async () => {
    const duplicate = build();
    duplicate.wallet.runSerializable.mockRejectedValue({ code: 'P2002' });
    await expect(duplicate.service.handleStripeWebhook(Buffer.from('body'), {})).resolves.toEqual({ status: 'duplicate' });
    const failure = build();
    failure.wallet.runSerializable.mockRejectedValue(new Error('database offline'));
    await expect(failure.service.handleStripeWebhook(Buffer.from('body'), {})).rejects.toThrow('database offline');
  });

  it('replays a parseable stored event with a distinct persisted id', async () => {
    const { service, prisma, tx } = build();
    prisma.billingWebhookEvent.findUnique.mockResolvedValue({ id: 'stored-1', provider: 'stripe', eventId: 'evt-1', eventType: 'completed', payload: {} });
    await expect(service.replayWebhookEvent('stored-1')).resolves.toEqual({ status: 'credited' });
    expect(tx.billingWebhookEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventId: expect.stringMatching(/^evt-1:replay:stored-1:/) }) }));
  });

  it('rejects missing, unparseable, and unknown-provider replay rows', async () => {
    const missing = build();
    await expect(missing.service.replayWebhookEvent('missing')).rejects.toBeInstanceOf(NotFoundException);
    const bad = build();
    bad.prisma.billingWebhookEvent.findUnique.mockResolvedValue({ id: 'bad', provider: 'stripe', eventId: 'e', eventType: 'x', payload: {} });
    bad.stripe.parseStoredWebhookEvent.mockReturnValue(null);
    await expect(bad.service.replayWebhookEvent('bad')).rejects.toBeInstanceOf(BadRequestException);
    const unknown = build();
    unknown.prisma.billingWebhookEvent.findUnique.mockResolvedValue({ id: 'bad', provider: 'other', eventId: 'e', eventType: 'x', payload: {} });
    await expect(unknown.service.replayWebhookEvent('bad')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['completed', 'Payment complete'],
    ['refunded', 'Payment refunded'],
    ['chargeback', 'Payment disputed'],
    ['failed', 'Payment not completed'],
    ['canceled', 'Payment not completed'],
  ] as const)('publishes deterministic %s notifications', async (type, title) => {
    const { service, prisma, notifications } = build();
    prisma.billingWebhookEvent.findUnique.mockResolvedValue({ intentId: intent.id });
    prisma.billingIntent.findUnique.mockResolvedValue({ id: intent.id, userId: intent.userId, creditsAmount: intent.creditsAmount });
    await (service as never as { notifyPaymentFinal(provider: 'stripe', id: string, type: VerifiedWebhookEvent['type']): Promise<void> }).notifyPaymentFinal('stripe', 'event', type);
    expect(notifications.publishSafely).toHaveBeenCalledWith(expect.objectContaining({ title, dedupeKey: 'payment:stripe:event' }));
  });

  it('skips payment notification when the event or intent cannot be resolved', async () => {
    const first = build();
    await (first.service as never as { notifyPaymentFinal(provider: 'stripe', id: string, type: 'completed'): Promise<void> }).notifyPaymentFinal('stripe', 'event', 'completed');
    expect(first.notifications.publishSafely).not.toHaveBeenCalled();
    const second = build();
    second.prisma.billingWebhookEvent.findUnique.mockResolvedValue({ intentId: intent.id });
    await (second.service as never as { notifyPaymentFinal(provider: 'stripe', id: string, type: 'completed'): Promise<void> }).notifyPaymentFinal('stripe', 'event', 'completed');
    expect(second.notifications.publishSafely).not.toHaveBeenCalled();
  });
});
