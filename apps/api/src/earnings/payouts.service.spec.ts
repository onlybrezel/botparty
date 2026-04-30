import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PayoutRequestStatus, TransactionType } from '@botparty/prisma';
import { PayoutsService } from './payouts.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const reviewer = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr';

function build() {
  const prisma = {
    payoutRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    },
  } as unknown as PrismaService;

  const wallet = {
    getBalance: jest.fn().mockResolvedValue(100_000),
    debit: jest.fn().mockResolvedValue({ balanceAfter: 0 }),
  } as unknown as WalletService;

  const svc = new PayoutsService(prisma, wallet);
  return {
    svc,
    prisma: prisma as unknown as { payoutRequest: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } },
    wallet: wallet as unknown as { getBalance: jest.Mock; debit: jest.Mock },
  };
}

describe('PayoutsService.createRequest', () => {
  it('rejects amounts below the minimum', async () => {
    const { svc } = build();
    await expect(
      svc.createRequest({ userId, amount: 500, destination: 'paypal@me' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects amounts above the maximum', async () => {
    const { svc } = build();
    await expect(
      svc.createRequest({ userId, amount: 2_000_000, destination: 'paypal@me' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when balance is insufficient', async () => {
    const { svc, wallet } = build();
    wallet.getBalance.mockResolvedValue(500);
    await expect(
      svc.createRequest({ userId, amount: 5_000, destination: 'paypal@me' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when an open request already exists', async () => {
    const { svc, prisma } = build();
    prisma.payoutRequest.findFirst.mockResolvedValue({ id: 'open' });
    await expect(
      svc.createRequest({ userId, amount: 5_000, destination: 'paypal@me' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a PENDING request and truncates oversized fields', async () => {
    const { svc, prisma } = build();
    const longDest = 'x'.repeat(200);
    const longNotes = 'n'.repeat(2000);
    await svc.createRequest({ userId, amount: 5_000, destination: longDest, notes: longNotes });
    expect(prisma.payoutRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: PayoutRequestStatus.PENDING,
        destination: 'x'.repeat(128),
        notes: 'n'.repeat(1000),
      }),
    });
  });
});

describe('PayoutsService.markPaid', () => {
  it('throws NotFound when missing', async () => {
    const { svc, prisma } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue(null);
    await expect(svc.markPaid('p1', reviewer)).rejects.toThrow(NotFoundException);
  });

  it('refuses to pay non-approved requests', async () => {
    const { svc, prisma } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue({
      id: 'p1', userId, amount: 5_000, status: PayoutRequestStatus.PENDING,
    });
    await expect(svc.markPaid('p1', reviewer)).rejects.toThrow(ForbiddenException);
  });

  it('debits via wallet with WITHDRAWAL and marks PAID', async () => {
    const { svc, prisma, wallet } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue({
      id: 'p1', userId, amount: 5_000, status: PayoutRequestStatus.APPROVED,
    });
    await svc.markPaid('p1', reviewer);
    expect(wallet.debit).toHaveBeenCalledWith(
      userId,
      5_000,
      TransactionType.WITHDRAWAL,
      expect.objectContaining({ metadata: expect.objectContaining({ payoutRequestId: 'p1', reviewerId: reviewer }) }),
    );
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PayoutRequestStatus.PAID }) }),
    );
  });
});

describe('PayoutsService.approve / reject', () => {
  it('approve transitions PENDING → APPROVED', async () => {
    const { svc, prisma } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue({ id: 'p1', userId, status: PayoutRequestStatus.PENDING });
    await svc.approve('p1', reviewer);
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PayoutRequestStatus.APPROVED }) }),
    );
  });

  it('approve refuses non-pending requests', async () => {
    const { svc, prisma } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue({ id: 'p1', userId, status: PayoutRequestStatus.PAID });
    await expect(svc.approve('p1', reviewer)).rejects.toThrow(ForbiddenException);
  });

  it('reject works on any status (records reason)', async () => {
    const { svc, prisma } = build();
    prisma.payoutRequest.findUnique.mockResolvedValue({ id: 'p1', userId, status: PayoutRequestStatus.APPROVED, notes: null });
    await svc.reject('p1', reviewer, 'fraud check');
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PayoutRequestStatus.REJECTED, notes: 'fraud check' }),
      }),
    );
  });
});
