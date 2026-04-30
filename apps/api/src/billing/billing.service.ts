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

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly stripe: StripeProvider,
    private readonly paypal: PaypalProvider,
    private readonly config: ConfigService,
  ) {}

  listPackages() {
    return CREDIT_PACKAGES;
  }

  private getProvider(name: string): PaymentProvider {
    if (name === 'stripe') return this.stripe;
    if (name === 'paypal') return this.paypal;
    throw new BadRequestException('Unknown payment provider');
  }

  async createCheckout(input: { userId: string; provider: string; packageId: string }) {
    const pkg = findPackage(input.packageId);
    if (!pkg) throw new NotFoundException('Unknown credit package');

    const provider = this.getProvider(input.provider);

    const intent = await this.prisma.billingIntent.create({
      data: {
        userId: input.userId,
        provider: provider.name,
        providerRef: 'pending',
        packageId: pkg.id,
        amountCents: pkg.amountCents,
        currency: pkg.currency,
        creditsAmount: pkg.credits,
        status: BillingIntentStatus.PENDING,
        metadata: { packageId: pkg.id, label: pkg.label } satisfies Prisma.InputJsonValue,
      },
    });

    const baseUrl = this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3000';
    const session = await provider.createCheckout({
      intent,
      successUrl: `${baseUrl}/wallet?status=success`,
      cancelUrl: `${baseUrl}/wallet?status=cancelled`,
    });

    await this.prisma.billingIntent.update({
      where: { id: intent.id },
      data: { providerRef: session.providerRef },
    });

    return {
      intentId: intent.id,
      provider: provider.name,
      redirectUrl: session.redirectUrl,
    };
  }

  async handleStripeWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = await this.stripe.verifyWebhook(rawBody, headers);
    return this.processVerifiedEvent('stripe', event);
  }

  async handlePaypalWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = await this.paypal.verifyWebhook(rawBody, headers);
    return this.processVerifiedEvent('paypal', event);
  }

  private async processVerifiedEvent(provider: 'stripe' | 'paypal', event: VerifiedWebhookEvent) {
    // Event-level dedup: bail early if we've already processed this provider event.
    const dupe = await this.prisma.billingWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: event.eventId } },
    });
    if (dupe) {
      return { status: 'duplicate' };
    }

    if (event.type === 'unknown' || !event.intentId) {
      // Still record for audit so we don't reprocess.
      await this.prisma.billingWebhookEvent
        .create({
          data: {
            provider,
            eventId: event.eventId,
            eventType: event.type,
            payload: event.rawPayload as Prisma.InputJsonValue,
            processedAt: new Date(),
          },
        })
        .catch(() => undefined);
      return { status: 'ignored' };
    }

    const intent = await this.prisma.billingIntent.findUnique({
      where: { id: event.intentId },
    });
    if (!intent) {
      this.logger.warn(`Webhook references missing intent ${event.intentId}`);
      return { status: 'ignored' };
    }

    if (event.type === 'completed') {
      // Cross-validate amount/currency.
      if (event.amountCents > 0 && event.amountCents !== intent.amountCents) {
        this.logger.error(
          `Webhook amount mismatch for ${intent.id}: expected ${intent.amountCents}, got ${event.amountCents}`,
        );
        await this.recordEvent(provider, event);
        return { status: 'amount_mismatch' };
      }

      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.billingIntent.updateMany({
          where: { id: intent.id, status: BillingIntentStatus.PENDING },
          data: { status: BillingIntentStatus.PAID, updatedAt: new Date() },
        });
        if (updated.count === 0) {
          // Already processed.
          return;
        }
        await tx.billingWebhookEvent.create({
          data: {
            provider,
            eventId: event.eventId,
            eventType: event.type,
            payload: event.rawPayload as Prisma.InputJsonValue,
            processedAt: new Date(),
          },
        });
      });

      // Credit outside the inner transaction — wallet handles its own atomicity.
      const refreshed = await this.prisma.billingIntent.findUnique({ where: { id: intent.id } });
      if (refreshed?.status === BillingIntentStatus.PAID) {
        // Idempotency check: ensure we haven't already credited this intent.
        const alreadyCredited = await this.prisma.transaction.findFirst({
          where: {
            userId: intent.userId,
            type: TransactionType.DEPOSIT,
            metadata: { path: ['billingIntentId'], equals: intent.id },
          },
          select: { id: true },
        });
        if (!alreadyCredited) {
          await this.wallet.credit(intent.userId, intent.creditsAmount, TransactionType.DEPOSIT, {
            description: `${intent.creditsAmount} credits via ${provider}`,
            metadata: {
              billingIntentId: intent.id,
              provider,
              amountCents: intent.amountCents,
              currency: intent.currency,
            },
          });
        }
      }
      return { status: 'credited' };
    }

    if (event.type === 'failed') {
      await this.prisma.billingIntent.updateMany({
        where: { id: intent.id, status: BillingIntentStatus.PENDING },
        data: { status: BillingIntentStatus.FAILED, updatedAt: new Date() },
      });
      await this.recordEvent(provider, event);
      return { status: 'failed' };
    }

    if (event.type === 'refunded' || event.type === 'chargeback') {
      const newStatus =
        event.type === 'refunded' ? BillingIntentStatus.REFUNDED : BillingIntentStatus.CHARGEBACK;
      const txType = event.type === 'refunded' ? TransactionType.REFUND : TransactionType.CHARGEBACK;
      await this.prisma.billingIntent.update({
        where: { id: intent.id },
        data: { status: newStatus, updatedAt: new Date() },
      });
      await this.recordEvent(provider, event);
      // Reverse the credit. Balance may go negative; account-freeze handled separately.
      await this.wallet.debit(intent.userId, intent.creditsAmount, txType, {
        description: `${event.type} of intent ${intent.id}`,
        metadata: { billingIntentId: intent.id, provider },
      }).catch((err: unknown) => {
        this.logger.error(`Reversal debit failed for ${intent.id}: ${(err as Error).message}`);
      });
      return { status: event.type };
    }

    return { status: 'noop' };
  }

  private async recordEvent(provider: 'stripe' | 'paypal', event: VerifiedWebhookEvent) {
    await this.prisma.billingWebhookEvent
      .create({
        data: {
          provider,
          eventId: event.eventId,
          eventType: event.type,
          payload: event.rawPayload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }
}
