import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingIntentStatus, Prisma, TransactionType } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { findPackage, CREDIT_PACKAGES } from './credit-packages';
import { StripeProvider } from './providers/stripe.provider';
import { PaypalProvider } from './providers/paypal.provider';
import type { PaymentProvider, VerifiedWebhookEvent } from './providers/payment-provider.interface';
import { FeatureFlagsService } from '../common/feature-flags.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly stripe: StripeProvider,
    private readonly paypal: PaypalProvider,
    private readonly config: ConfigService,
    private readonly features: FeatureFlagsService,
    private readonly notifications: NotificationsService,
  ) {}

  listPackages() {
    return this.features.isEnabled('BILLING') ? CREDIT_PACKAGES : [];
  }

  listSubscriptionPlans() {
    return [];
  }

  async listWebhookEvents(limit = 100) {
    const events = await this.prisma.billingWebhookEvent.findMany({
      orderBy: [{ processedAt: 'desc' }, { id: 'desc' }],
      take: Math.max(1, Math.min(limit, 200)),
    });

    return {
      items: events.map((event) => {
        const provider = this.getProvider(event.provider);
        const parsed = provider.parseStoredWebhookEvent({
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event.payload,
        });

        return {
          id: event.id,
          provider: event.provider,
          eventId: event.eventId,
          eventType: event.eventType,
          intentId: parsed?.intentId ?? null,
          providerRef: parsed?.providerRef ?? null,
          amountCents: parsed?.amountCents ?? 0,
          currency: parsed?.currency ?? null,
          processedAt: event.processedAt.toISOString(),
          payload: event.payload as Prisma.JsonValue,
        };
      }),
    };
  }

  private getProvider(name: string): PaymentProvider {
    if (name === 'stripe') return this.stripe;
    if (name === 'paypal') return this.paypal;
    throw new BadRequestException('Unknown payment provider');
  }

  async createCheckout(input: {
    userId: string;
    provider: string;
    packageId: string;
    successUrl?: string;
    cancelUrl?: string;
    termsVersion: string;
    immediateDeliveryConsent: true;
  }) {
    this.features.assertEnabled('BILLING');
    const pkg = findPackage(input.packageId);
    if (!pkg) throw new NotFoundException('Unknown credit package');

    const provider = this.getProvider(input.provider);

    const intent = await this.prisma.billingIntent.create({
      data: {
        userId: input.userId,
        provider: provider.name,
        providerRef: null,
        packageId: pkg.id,
        amountCents: pkg.amountCents,
        currency: pkg.currency,
        creditsAmount: pkg.credits,
        status: BillingIntentStatus.CREATING,
        termsVersion: input.termsVersion,
        immediateDeliveryConsentAt: new Date(),
        metadata: { packageId: pkg.id, label: pkg.label } satisfies Prisma.InputJsonValue,
      },
    });

    const baseUrl = this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3000';
    let session;
    try {
      session = await provider.createCheckout({
        intent,
        successUrl: input.successUrl?.trim() || `${baseUrl}/wallet?status=success`,
        cancelUrl: input.cancelUrl?.trim() || `${baseUrl}/wallet?status=cancelled`,
      });
      await this.prisma.billingIntent.update({
        where: { id: intent.id },
        data: { providerRef: session.providerRef, status: BillingIntentStatus.PENDING },
      });
    } catch (error) {
      await this.prisma.billingIntent.update({
        where: { id: intent.id },
        data: {
          status: BillingIntentStatus.FAILED,
          metadata: {
            packageId: pkg.id,
            label: pkg.label,
            checkoutError: error instanceof Error ? error.name : 'ProviderError',
          },
        },
      });
      throw error;
    }

    return {
      intentId: intent.id,
      provider: provider.name,
      redirectUrl: session.redirectUrl,
    };
  }

  async createSubscriptionCheckout(input: {
    userId: string;
    provider: string;
    planId: string;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    void input;
    throw new NotFoundException('Subscriptions are not available.');
  }

  async handleStripeWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = await this.stripe.verifyWebhook(rawBody, headers);
    return this.processVerifiedEvent('stripe', event);
  }

  async handlePaypalWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = await this.paypal.verifyWebhook(rawBody, headers);
    const verified = await this.processVerifiedEvent('paypal', event);
    if (event.type !== 'approved' || !event.intentId) return verified;
    const captured = await this.paypal.captureApprovedOrder(event.providerRef, event.intentId);
    return this.processVerifiedEvent('paypal', captured);
  }

  async replayWebhookEvent(id: string) {
    const stored = await this.prisma.billingWebhookEvent.findUnique({
      where: { id },
    });
    if (!stored) {
      throw new NotFoundException('Webhook event not found');
    }

    const provider = this.getProvider(stored.provider);
    const parsed = provider.parseStoredWebhookEvent({
      eventId: stored.eventId,
      eventType: stored.eventType,
      payload: stored.payload,
    });
    if (!parsed) {
      throw new BadRequestException('Stored webhook payload cannot be replayed');
    }

    return this.processVerifiedEvent(provider.name, parsed, {
      ignoreDuplicateCheck: true,
      replayTag: `replay:${stored.id}:${Date.now()}`,
    });
  }

  private async processVerifiedEvent(
    provider: 'stripe' | 'paypal',
    event: VerifiedWebhookEvent,
    options: { ignoreDuplicateCheck?: boolean; replayTag?: string } = {},
  ) {
    const persistedEventId =
      options.ignoreDuplicateCheck ? `${event.eventId}:${options.replayTag ?? 'replay'}` : event.eventId;
    try {
      const result = await this.wallet.runSerializable(async (tx) => {
        const intent = await this.resolveIntent(tx, provider, event);
        if (!intent || event.type === 'unknown') {
          await this.recordEvent(tx, provider, event, persistedEventId, 'IGNORED', intent?.id ?? null);
          return { status: 'ignored' };
        }

        await tx.$executeRaw`SELECT id FROM billing_intents WHERE id = ${intent.id}::uuid FOR UPDATE`;
        const lockedIntent = await tx.billingIntent.findUniqueOrThrow({ where: { id: intent.id } });

        if (event.type === 'approved') {
          await this.recordEvent(tx, provider, event, persistedEventId, 'PROCESSED', lockedIntent.id);
          return { status: 'approved' };
        }

        const invalid = this.validateEvent(lockedIntent, provider, event);
        if (invalid) {
          await tx.billingIntent.update({
            where: { id: lockedIntent.id },
            data: { status: BillingIntentStatus.NEEDS_REVIEW },
          });
          await this.recordEvent(tx, provider, event, persistedEventId, 'NEEDS_REVIEW', lockedIntent.id, invalid);
          return { status: 'needs_review', reason: invalid };
        }

        if (event.type === 'completed') {
          const existingCredit = await tx.transaction.findUnique({
            where: { billingIntentId: lockedIntent.id },
            select: { id: true },
          });
          if (!existingCredit) {
            await this.wallet.creditInTransaction(
              tx,
              lockedIntent.userId,
              lockedIntent.creditsAmount,
              TransactionType.DEPOSIT,
              {
                billingIntentId: lockedIntent.id,
                description: `${lockedIntent.creditsAmount} credits via ${provider}`,
                metadata: {
                  billingIntentId: lockedIntent.id,
                  provider,
                  amountCents: lockedIntent.amountCents,
                  currency: lockedIntent.currency,
                },
              },
            );
          }
          await tx.billingIntent.update({
            where: { id: lockedIntent.id },
            data: {
              status: BillingIntentStatus.PAID,
              paidAt: lockedIntent.paidAt ?? new Date(),
              providerPaymentRef: event.paymentRef ?? lockedIntent.providerPaymentRef,
              providerSubscriptionRef: event.subscriptionRef ?? lockedIntent.providerSubscriptionRef,
              providerCustomerRef: event.customerRef ?? lockedIntent.providerCustomerRef,
            },
          });
          await this.recordEvent(tx, provider, event, persistedEventId, 'PROCESSED', lockedIntent.id);
          return { status: existingCredit ? 'duplicate_credit' : 'credited' };
        }

        if (event.type === 'failed' || event.type === 'canceled') {
          if (lockedIntent.status === BillingIntentStatus.PENDING || lockedIntent.status === BillingIntentStatus.CREATING) {
            await tx.billingIntent.update({
              where: { id: lockedIntent.id },
              data: {
                status: event.type === 'failed' ? BillingIntentStatus.FAILED : BillingIntentStatus.CANCELED,
              },
            });
          }
          await this.recordEvent(tx, provider, event, persistedEventId, 'PROCESSED', lockedIntent.id);
          return { status: event.type };
        }

        if (event.type === 'refunded' || event.type === 'chargeback') {
          const requestedCredits = event.amountCents > 0
            ? Math.ceil((lockedIntent.creditsAmount * event.amountCents) / lockedIntent.amountCents)
            : lockedIntent.creditsAmount;
          const creditsToReverse = Math.min(
            requestedCredits,
            lockedIntent.creditsAmount - lockedIntent.reversedCredits,
          );
          if (creditsToReverse <= 0) {
            await this.recordEvent(tx, provider, event, persistedEventId, 'PROCESSED', lockedIntent.id);
            return { status: 'duplicate_reversal' };
          }
          await this.wallet.reverseBillingCreditInTransaction(tx, {
            userId: lockedIntent.userId,
            amount: creditsToReverse,
            type: event.type === 'refunded' ? TransactionType.REFUND : TransactionType.CHARGEBACK,
            reversalKey: `${provider}:${event.eventId}:${event.type}`,
            billingIntentId: lockedIntent.id,
            metadata: { billingIntentId: lockedIntent.id, provider, providerEventId: event.eventId },
          });
          const reversedCredits = lockedIntent.reversedCredits + creditsToReverse;
          await tx.billingIntent.update({
            where: { id: lockedIntent.id },
            data: {
              reversedCredits,
              refundedAt: new Date(),
              status:
                reversedCredits >= lockedIntent.creditsAmount
                  ? event.type === 'refunded'
                    ? BillingIntentStatus.REFUNDED
                    : BillingIntentStatus.CHARGEBACK
                  : BillingIntentStatus.PAID,
            },
          });
          await this.recordEvent(tx, provider, event, persistedEventId, 'PROCESSED', lockedIntent.id);
          return { status: event.type, creditsReversed: creditsToReverse };
        }

        await this.recordEvent(tx, provider, event, persistedEventId, 'IGNORED', lockedIntent.id);
        return { status: 'ignored' };
      });
      if (['completed', 'failed', 'canceled', 'refunded', 'chargeback'].includes(event.type)) {
        await this.notifyPaymentFinal(provider, persistedEventId, event.type);
      }
      return result;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { status: 'duplicate' };
      this.logger.error(`Billing event ${provider}/${event.eventId} failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private async notifyPaymentFinal(
    provider: 'stripe' | 'paypal',
    persistedEventId: string,
    eventType: VerifiedWebhookEvent['type'],
  ) {
    const stored = await this.prisma.billingWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: persistedEventId } },
      select: { intentId: true },
    });
    if (!stored?.intentId) return;
    const intent = await this.prisma.billingIntent.findUnique({
      where: { id: stored.intentId },
      select: { id: true, userId: true, creditsAmount: true },
    });
    if (!intent) return;
    const copy = eventType === 'completed'
      ? {
          title: 'Payment complete',
          body: `${intent.creditsAmount} credits were added to your wallet.`,
        }
      : eventType === 'refunded'
        ? { title: 'Payment refunded', body: 'Your refund was recorded in Wallet.' }
        : eventType === 'chargeback'
          ? { title: 'Payment disputed', body: 'A payment dispute was recorded in Wallet.' }
          : { title: 'Payment not completed', body: 'No credits were added. You can try again from Wallet.' };
    await this.notifications.publishSafely({
      userId: intent.userId,
      kind: 'PAYMENT_FINAL',
      category: 'FINANCE',
      title: copy.title,
      body: copy.body,
      actionUrl: '/wallet',
      dedupeKey: `payment:${provider}:${persistedEventId}`,
    });
  }

  private async resolveIntent(
    tx: Prisma.TransactionClient,
    provider: 'stripe' | 'paypal',
    event: VerifiedWebhookEvent,
  ) {
    const references = [event.providerRef, event.paymentRef, event.relatedProviderRef].filter(
      (value): value is string => Boolean(value),
    );
    return tx.billingIntent.findFirst({
      where: {
        provider,
        OR: [
          ...(event.intentId ? [{ id: event.intentId }] : []),
          ...references.flatMap((reference) => [
            { providerRef: reference },
            { providerPaymentRef: reference },
            { providerSubscriptionRef: reference },
          ]),
        ],
      },
    });
  }

  private validateEvent(
    intent: { provider: string; providerRef: string | null; amountCents: number; currency: string; status: BillingIntentStatus },
    provider: 'stripe' | 'paypal',
    event: VerifiedWebhookEvent,
  ): string | null {
    if (intent.provider !== provider) return 'PROVIDER_MISMATCH';
    if (event.currency && event.currency.toUpperCase() !== intent.currency.toUpperCase()) {
      return 'CURRENCY_MISMATCH';
    }
    if (event.type === 'completed' && event.amountCents !== intent.amountCents) {
      return 'AMOUNT_MISMATCH';
    }
    if ((event.type === 'refunded' || event.type === 'chargeback') && intent.status === BillingIntentStatus.PENDING) {
      return 'REVERSAL_BEFORE_PAYMENT';
    }
    return null;
  }

  private recordEvent(
    tx: Prisma.TransactionClient,
    provider: 'stripe' | 'paypal',
    event: VerifiedWebhookEvent,
    persistedEventId: string,
    status: 'PROCESSED' | 'NEEDS_REVIEW' | 'FAILED' | 'IGNORED',
    intentId: string | null,
    errorCode?: string,
  ) {
    return tx.billingWebhookEvent.create({
      data: {
        provider,
        eventId: persistedEventId,
        eventType: event.type,
        payload: event.rawPayload as Prisma.InputJsonValue,
        intentId,
        status,
        errorCode: errorCode ?? null,
        processedAt: new Date(),
      },
    });
  }
}
