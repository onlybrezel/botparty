import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutDestinationType, PayoutRequestStatus, TransactionType, type Prisma } from '@botparty/prisma';
import { LIMITS } from '@botparty/shared';
import { randomUUID } from 'crypto';
import { AeadCipher } from '../common/aead-cipher';
import { FeatureFlagsService } from '../common/feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
type PayoutDatabase = { payoutRequest: Pick<PrismaService['payoutRequest'], 'findMany' | 'findUnique' | 'update'> };
type PayoutTransaction = {
  $executeRaw: Prisma.TransactionClient['$executeRaw'];
  adminAuditLog: Pick<Prisma.TransactionClient['adminAuditLog'], 'create'>;
  payoutRequest: Pick<Prisma.TransactionClient['payoutRequest'], 'create' | 'findFirst' | 'findUnique' | 'findUniqueOrThrow' | 'update' | 'updateMany'>;
  user: Pick<Prisma.TransactionClient['user'], 'findUnique'>;
};
interface PayoutWallet {
  runSerializable<T>(fn: (tx: PayoutTransaction) => Promise<T>): Promise<T>;
  debitInTransaction(
    tx: PayoutTransaction,
    userId: string,
    amount: number,
    type: TransactionType,
    metadata: Parameters<WalletService['debitInTransaction']>[4],
  ): Promise<unknown>;
}
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PayoutsService {
  private readonly destinationCipher: AeadCipher;

  constructor(
    @Inject(PrismaService) private readonly prisma: PayoutDatabase,
    @Inject(WalletService) private readonly wallet: PayoutWallet,
    @Inject(FeatureFlagsService) private readonly features: Pick<FeatureFlagsService, 'assertEnabled'>,
    @Inject(NotificationsService) private readonly notifications: Pick<NotificationsService, 'publishSafely'>,
    @Inject(ConfigService) config: { get(key: string): unknown },
  ) {
    const readConfig = (name: string): string => {
      const value = config.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const key = readConfig('PAYOUT_DESTINATION_ENCRYPTION_KEY')
      || readConfig('WEBHOOK_SECRET_ENCRYPTION_KEY')
      || readConfig('JWT_SECRET')
      || 'botparty-payout-dev-key-at-least-32-characters';
    this.destinationCipher = new AeadCipher(
      key,
      readConfig('PAYOUT_DESTINATION_ENCRYPTION_KEY_PREVIOUS')
        .split(',')
        .map((entry) => entry.trim()),
    );
  }

  async createRequest(input: { userId: string; amount: number; destination: string; destinationType: 'PAYPAL_EMAIL' | 'IBAN'; notes?: string }) {
    this.features.assertEnabled('PAYOUTS');
    if (input.amount < LIMITS.MIN_PAYOUT_REQUEST_CREDITS || input.amount > LIMITS.MAX_PAYOUT_REQUEST_CREDITS) {
      throw new BadRequestException('Payout amount out of allowed range');
    }
    const destination = input.destination.replace(/\s+/g, '').trim();
    const destinationType = input.destinationType === 'PAYPAL_EMAIL'
      ? PayoutDestinationType.PAYPAL_EMAIL
      : PayoutDestinationType.IBAN;
    if (destinationType === PayoutDestinationType.PAYPAL_EMAIL && !/^\S+@\S+\.\S+$/.test(destination)) {
      throw new BadRequestException('Invalid PayPal email address');
    }
    if (destinationType === PayoutDestinationType.IBAN && !/^[A-Z]{2}[A-Z0-9]{13,32}$/i.test(destination)) {
      throw new BadRequestException('Invalid IBAN');
    }

    const id = randomUUID();
    return this.wallet.runSerializable(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { balance: true, financialHold: true } });
      if (!user) throw new NotFoundException('User not found');
      if (user.financialHold) throw new ForbiddenException('Account is under financial review');
      if (user.balance < input.amount) {
        throw new BadRequestException({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient balance for payout', balance: user.balance });
      }
      const pending = await tx.payoutRequest.findFirst({
        where: { userId: input.userId, status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.APPROVED] } },
        select: { id: true },
      });
      if (pending) throw new ConflictException('You already have an open payout request');
      return tx.payoutRequest.create({
        data: {
          id,
          userId: input.userId,
          amount: input.amount,
          destinationType,
          destination: this.destinationCipher.encrypt(destination, `payout:${id}`),
          destinationLast4: destination.slice(-4),
          notes: input.notes?.trim().slice(0, 1000) || null,
          status: PayoutRequestStatus.PENDING,
        },
      });
    }).then(async (request) => {
      await this.notifyStatus(request.userId, request.id, 'PENDING');
      return this.toPublicRecord(request);
    });
  }

  async listForUser(userId: string) {
    const requests = await this.prisma.payoutRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return requests.map((request) => this.toPublicRecord(request));
  }

  async listForReview() {
    const requests = await this.prisma.payoutRequest.findMany({
      where: { status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.APPROVED] } },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, username: true } } },
    });
    return requests.map((request) => ({ ...this.toPublicRecord(request), user: request.user }));
  }

  async approve(id: string, reviewerId: string) {
    this.features.assertEnabled('PAYOUTS');
    return this.wallet.runSerializable(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Payout request not found');
      if (request.userId === reviewerId) throw new ForbiddenException('Requester cannot approve the payout');
      const updated = await tx.payoutRequest.updateMany({
        where: { id, status: PayoutRequestStatus.PENDING },
        data: { status: PayoutRequestStatus.APPROVED, reviewedById: reviewerId, reviewedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException('Payout request is no longer pending');
      await tx.adminAuditLog.create({
        data: { actorId: reviewerId, action: 'payout_approved', targetType: 'payout', targetId: id },
      });
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    }).then(async (request) => {
      await this.notifyStatus(request.userId, request.id, 'APPROVED');
      return this.toPublicRecord(request);
    });
  }

  async reject(id: string, reviewerId: string, reason: string) {
    this.features.assertEnabled('PAYOUTS');
    return this.wallet.runSerializable(async (tx) => {
      const request = await tx.payoutRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Payout request not found');
      if (request.userId === reviewerId) throw new ForbiddenException('Requester cannot reject the payout');
      const updated = await tx.payoutRequest.updateMany({
        where: { id, status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.APPROVED] } },
        data: { status: PayoutRequestStatus.REJECTED, reviewedById: reviewerId, reviewedAt: new Date(), notes: reason.trim().slice(0, 1000) },
      });
      if (updated.count !== 1) throw new ConflictException('Paid or rejected payouts are immutable');
      await tx.adminAuditLog.create({
        data: { actorId: reviewerId, action: 'payout_rejected', targetType: 'payout', targetId: id, payload: { reason: reason.trim().slice(0, 1000) } },
      });
      return tx.payoutRequest.findUniqueOrThrow({ where: { id } });
    }).then(async (request) => {
      await this.notifyStatus(request.userId, request.id, 'REJECTED');
      return this.toPublicRecord(request);
    });
  }

  async markPaid(id: string, payerId: string, providerRef: string) {
    this.features.assertEnabled('PAYOUTS');
    const reference = providerRef.trim();
    if (reference.length < 4) throw new BadRequestException('External payout reference is required');
    return this.wallet.runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT id FROM payout_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const request = await tx.payoutRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Payout request not found');
      if (request.status !== PayoutRequestStatus.APPROVED) throw new ForbiddenException('Only approved requests can be marked paid');
      if (request.userId === payerId || request.reviewedById === payerId) {
        throw new ForbiddenException('Requester, approver and payer must be different people');
      }
      await this.wallet.debitInTransaction(tx, request.userId, request.amount, TransactionType.WITHDRAWAL, {
        payoutRequestId: request.id,
        description: `Payout ${request.id}`,
        metadata: { payoutRequestId: request.id, reviewerId: request.reviewedById, payerId, providerRef: reference },
      });
      const paid = await tx.payoutRequest.update({
        where: { id },
        data: { status: PayoutRequestStatus.PAID, paidById: payerId, paidAt: new Date(), providerRef: reference },
      });
      await tx.adminAuditLog.create({
        data: { actorId: payerId, action: 'payout_paid', targetType: 'payout', targetId: id, payload: { providerRef: reference } },
      });
      return paid;
    }).then(async (request) => {
      await this.notifyStatus(request.userId, request.id, 'PAID');
      return this.toPublicRecord(request);
    });
  }

  async revealDestination(id: string, payerId: string) {
    const request = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Payout request not found');
    if (request.status !== PayoutRequestStatus.APPROVED) throw new ForbiddenException('Payout is not approved');
    if (request.userId === payerId || request.reviewedById === payerId) {
      throw new ForbiddenException('Requester and approver cannot execute the payout');
    }
    const decrypted = this.destinationCipher.decrypt(request.destination, `payout:${id}`);
    if (decrypted.needsRotation) {
      await this.prisma.payoutRequest.update({
        where: { id },
        data: { destination: this.destinationCipher.encrypt(decrypted.plaintext, `payout:${id}`) },
      });
    }
    return { destinationType: request.destinationType, destination: decrypted.plaintext };
  }

  private toPublicRecord<T extends { destination: string; destinationType: PayoutDestinationType; destinationLast4: string }>(request: T) {
    const { destination: _destination, ...safe } = request;
    void _destination;
    return { ...safe, destination: `${request.destinationType === PayoutDestinationType.IBAN ? 'IBAN' : 'PayPal'} ••••${request.destinationLast4}` };
  }

  private notifyStatus(userId: string, payoutId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID') {
    const copy: readonly [string, string] = ({
      PENDING: ['Payout request received', 'Your payout request is waiting for review.'],
      APPROVED: ['Payout approved', 'Your payout request was approved and is ready for processing.'],
      REJECTED: ['Payout request declined', 'Your payout request was declined. Open Wallet for details.'],
      PAID: ['Payout sent', 'Your payout has been marked as sent.'],
    } satisfies Record<'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID', readonly [string, string]>)[status];
    return this.notifications.publishSafely({
      userId,
      kind: 'PAYOUT_STATUS',
      category: 'FINANCE',
      title: copy[0],
      body: copy[1],
      actionUrl: '/wallet',
      dedupeKey: `payout:${payoutId}:${status}`,
    });
  }
}
