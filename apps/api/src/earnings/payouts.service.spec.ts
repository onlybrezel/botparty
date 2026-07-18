import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PayoutDestinationType, PayoutRequestStatus, TransactionType } from '@botparty/prisma';
import { LIMITS } from '@botparty/shared';
import { AeadCipher } from '../common/aead-cipher';
import { PayoutsService } from './payouts.service';

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const reviewerId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const payerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const payoutId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const activeKey = 'test-payout-key-with-at-least-thirty-two-characters';

function build(configValues: Record<string, string | undefined> = { PAYOUT_DESTINATION_ENCRYPTION_KEY: activeKey }) {
  const request = {
    id: payoutId,
    userId,
    amount: 5_000,
    status: PayoutRequestStatus.PENDING,
    destinationType: PayoutDestinationType.PAYPAL_EMAIL,
    destination: new AeadCipher(activeKey).encrypt('payee@example.com', `payout:${payoutId}`),
    destinationLast4: '.com',
    notes: null,
    reviewedById: null,
    reviewedAt: null,
    paidById: null,
    providerRef: null,
    paidAt: null,
    createdAt: new Date('2026-07-17T00:00:00Z'),
    updatedAt: new Date('2026-07-17T00:00:00Z'),
  };
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue({ balance: 100_000, financialHold: false }) },
    payoutRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(request),
      findUniqueOrThrow: jest.fn().mockResolvedValue(request),
      create: jest.fn(({ data }) => Promise.resolve({ ...request, ...data })),
      update: jest.fn(({ data }) => Promise.resolve({ ...request, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    payoutRequest: {
      findUnique: jest.fn().mockResolvedValue(request),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(request),
    },
  };
  const wallet = {
    runSerializable: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    debitInTransaction: jest.fn().mockResolvedValue({ balanceAfter: 95_000 }),
  };
  const features = { assertEnabled: jest.fn() };
  const notifications = { publishSafely: jest.fn().mockResolvedValue(null) };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const service = new PayoutsService(prisma as never, wallet as never, features as never, notifications as never, config as never);
  return { service, prisma, wallet, features, notifications, tx, request, config };
}

describe('PayoutsService', () => {
  const paypalRequest = { userId, amount: 5_000, destinationType: 'PAYPAL_EMAIL' as const, destination: 'payee@example.com' };

  it.each([LIMITS.MIN_PAYOUT_REQUEST_CREDITS - 1, LIMITS.MAX_PAYOUT_REQUEST_CREDITS + 1])('rejects out-of-range amount %p', async (amount) => {
    await expect(build().service.createRequest({ ...paypalRequest, amount })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates PayPal and IBAN destinations', async () => {
    await expect(build().service.createRequest({ ...paypalRequest, destination: 'not-an-email' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build().service.createRequest({ ...paypalRequest, destinationType: 'IBAN', destination: '123' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes and encrypts PayPal destinations and notes', async () => {
    const { service, tx, features, notifications } = build();
    const result = await service.createRequest({ ...paypalRequest, destination: ' payee @example.com ', notes: `  ${'n'.repeat(1100)}  ` });
    const created = tx.payoutRequest.create.mock.calls[0]![0].data;
    expect(features.assertEnabled).toHaveBeenCalledWith('PAYOUTS');
    expect(created.destination).not.toContain('payee@example.com');
    expect(created.destinationType).toBe(PayoutDestinationType.PAYPAL_EMAIL);
    expect(created.notes).toHaveLength(1000);
    expect(result.destination).toBe('PayPal ••••.com');
    expect(notifications.publishSafely).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payout request received' }));
  });

  it('accepts a normalized IBAN and stores null notes', async () => {
    const { service, tx } = build();
    const result = await service.createRequest({ ...paypalRequest, destinationType: 'IBAN', destination: 'DE89 3704 0044 0532 0130 00', notes: '  ' });
    expect(tx.payoutRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ destinationType: PayoutDestinationType.IBAN, destinationLast4: '3000', notes: null }) }));
    expect(result.destination).toBe('IBAN ••••3000');
  });

  it('rejects unknown, held, underfunded, and already-pending accounts', async () => {
    const missing = build();
    missing.tx.user.findUnique.mockResolvedValue(null);
    await expect(missing.service.createRequest(paypalRequest)).rejects.toBeInstanceOf(NotFoundException);

    const held = build();
    held.tx.user.findUnique.mockResolvedValue({ balance: 100_000, financialHold: true });
    await expect(held.service.createRequest(paypalRequest)).rejects.toBeInstanceOf(ForbiddenException);

    const poor = build();
    poor.tx.user.findUnique.mockResolvedValue({ balance: 1, financialHold: false });
    await expect(poor.service.createRequest(paypalRequest)).rejects.toBeInstanceOf(BadRequestException);

    const duplicate = build();
    duplicate.tx.payoutRequest.findFirst.mockResolvedValue({ id: 'open' });
    await expect(duplicate.service.createRequest(paypalRequest)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists masked records for the user and review queue', async () => {
    const { service, prisma, request } = build();
    prisma.payoutRequest.findMany
      .mockResolvedValueOnce([request])
      .mockResolvedValueOnce([{ ...request, destinationType: PayoutDestinationType.IBAN, destinationLast4: '3000', user: { id: userId, username: 'host' } }]);
    await expect(service.listForUser(userId)).resolves.toEqual([expect.objectContaining({ destination: 'PayPal ••••.com' })]);
    await expect(service.listForReview()).resolves.toEqual([expect.objectContaining({ destination: 'IBAN ••••3000', user: { id: userId, username: 'host' } })]);
  });

  it('approves with compare-and-set, audit, masking, and notification', async () => {
    const { service, tx, notifications } = build();
    await service.approve(payoutId, reviewerId);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: payoutId, status: PayoutRequestStatus.PENDING }, data: expect.objectContaining({ reviewedById: reviewerId }) }));
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({ data: { actorId: reviewerId, action: 'payout_approved', targetType: 'payout', targetId: payoutId } });
    expect(notifications.publishSafely).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payout approved' }));
  });

  it('rejects invalid approval transitions and separation-of-duty violations', async () => {
    const missing = build();
    missing.tx.payoutRequest.findUnique.mockResolvedValue(null);
    await expect(missing.service.approve(payoutId, reviewerId)).rejects.toBeInstanceOf(NotFoundException);
    const self = build();
    await expect(self.service.approve(payoutId, userId)).rejects.toBeInstanceOf(ForbiddenException);
    const raced = build();
    raced.tx.payoutRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(raced.service.approve(payoutId, reviewerId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects with compare-and-set, bounded reason, audit, and notification', async () => {
    const { service, tx, notifications } = build();
    await service.reject(payoutId, reviewerId, `  ${'r'.repeat(1100)}  `);
    expect(tx.payoutRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PayoutRequestStatus.REJECTED, notes: expect.stringMatching(/^r{1000}$/) }) }));
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'payout_rejected' }) }));
    expect(notifications.publishSafely).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payout request declined' }));
  });

  it('rejects invalid rejection transitions and self-review', async () => {
    const missing = build();
    missing.tx.payoutRequest.findUnique.mockResolvedValue(null);
    await expect(missing.service.reject(payoutId, reviewerId, 'reason')).rejects.toBeInstanceOf(NotFoundException);
    const self = build();
    await expect(self.service.reject(payoutId, userId, 'reason')).rejects.toBeInstanceOf(ForbiddenException);
    const immutable = build();
    immutable.tx.payoutRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(immutable.service.reject(payoutId, reviewerId, 'reason')).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a usable external payment reference', async () => {
    await expect(build().service.markPaid(payoutId, payerId, ' x ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('debits and marks an approved payout paid with a third actor', async () => {
    const { service, tx, wallet, request, notifications } = build();
    tx.payoutRequest.findUnique.mockResolvedValue({ ...request, status: PayoutRequestStatus.APPROVED, reviewedById: reviewerId });
    await service.markPaid(payoutId, payerId, ' paypal-batch-1234 ');
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(wallet.debitInTransaction).toHaveBeenCalledWith(tx, userId, 5_000, TransactionType.WITHDRAWAL, expect.objectContaining({ payoutRequestId: payoutId, metadata: expect.objectContaining({ payerId, providerRef: 'paypal-batch-1234' }) }));
    expect(tx.payoutRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PayoutRequestStatus.PAID, paidById: payerId, providerRef: 'paypal-batch-1234' }) }));
    expect(notifications.publishSafely).toHaveBeenCalledWith(expect.objectContaining({ title: 'Payout sent' }));
  });

  it('rejects missing, unapproved, requester-paid, and approver-paid transitions', async () => {
    const missing = build();
    missing.tx.payoutRequest.findUnique.mockResolvedValue(null);
    await expect(missing.service.markPaid(payoutId, payerId, 'reference')).rejects.toBeInstanceOf(NotFoundException);
    const pending = build();
    await expect(pending.service.markPaid(payoutId, payerId, 'reference')).rejects.toBeInstanceOf(ForbiddenException);
    const requester = build();
    requester.tx.payoutRequest.findUnique.mockResolvedValue({ ...requester.request, status: PayoutRequestStatus.APPROVED, reviewedById: reviewerId });
    await expect(requester.service.markPaid(payoutId, userId, 'reference')).rejects.toBeInstanceOf(ForbiddenException);
    const approver = build();
    approver.tx.payoutRequest.findUnique.mockResolvedValue({ ...approver.request, status: PayoutRequestStatus.APPROVED, reviewedById: reviewerId });
    await expect(approver.service.markPaid(payoutId, reviewerId, 'reference')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reveals an approved destination only to an independent payer', async () => {
    const { service, prisma, request } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue({ ...request, status: PayoutRequestStatus.APPROVED, reviewedById: reviewerId });
    await expect(service.revealDestination(payoutId, payerId)).resolves.toEqual({ destinationType: PayoutDestinationType.PAYPAL_EMAIL, destination: 'payee@example.com' });
    expect(prisma.payoutRequest.update).not.toHaveBeenCalled();
  });

  it('rejects invalid destination reveals', async () => {
    const missing = build();
    missing.prisma.payoutRequest.findUnique.mockResolvedValue(null);
    await expect(missing.service.revealDestination(payoutId, payerId)).rejects.toBeInstanceOf(NotFoundException);
    const pending = build();
    await expect(pending.service.revealDestination(payoutId, payerId)).rejects.toBeInstanceOf(ForbiddenException);
    const requester = build();
    requester.prisma.payoutRequest.findUnique.mockResolvedValue({ ...requester.request, status: PayoutRequestStatus.APPROVED, reviewedById: reviewerId });
    await expect(requester.service.revealDestination(payoutId, userId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(requester.service.revealDestination(payoutId, reviewerId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotates a destination encrypted with a previous key after reveal', async () => {
    const previousKey = 'previous-payout-key-with-at-least-thirty-two-characters';
    const { service, prisma, request } = build({
      PAYOUT_DESTINATION_ENCRYPTION_KEY: activeKey,
      PAYOUT_DESTINATION_ENCRYPTION_KEY_PREVIOUS: ` ${previousKey}, `,
    });
    prisma.payoutRequest.findUnique.mockResolvedValue({
      ...request,
      status: PayoutRequestStatus.APPROVED,
      reviewedById: reviewerId,
      destination: new AeadCipher(previousKey).encrypt('old@example.com', `payout:${payoutId}`),
    });
    await expect(service.revealDestination(payoutId, payerId)).resolves.toEqual(expect.objectContaining({ destination: 'old@example.com' }));
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: payoutId }, data: { destination: expect.any(String) } }));
  });

  it('supports documented encryption-key fallback order', () => {
    expect(() => build({ WEBHOOK_SECRET_ENCRYPTION_KEY: activeKey }).service).not.toThrow();
    expect(() => build({ JWT_SECRET: activeKey }).service).not.toThrow();
    expect(() => build({}).service).not.toThrow();
  });
});
