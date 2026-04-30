import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@botparty/prisma';
import { WalletService } from './wallet.service';
import { PlatformUserService } from './platform-user.service';

describe('WalletService (validation paths)', () => {
  const platformId = '00000000-0000-0000-0000-00000000fee5';
  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function build() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as ConstructorParameters<typeof WalletService>[0];

    const platform = {
      getPlatformUserId: () => platformId,
      computeFee: (gross: number) => Math.floor(gross * 0.1),
      getFeeBps: () => 1000,
      isPlatformUser: (id: string) => id === platformId,
    } as unknown as PlatformUserService;

    const svc = new WalletService(prisma, platform);
    return { svc, prisma: prisma as unknown as { user: { findUnique: jest.Mock }; transaction: { findMany: jest.Mock } } };
  }

  describe('getBalance', () => {
    it('returns balance for existing user', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({ balance: 250 });
      await expect(svc.getBalance(userId)).resolves.toBe(250);
    });

    it('throws NotFound when user is missing', async () => {
      const { svc, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.getBalance(userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('credit/debit input validation', () => {
    it('rejects non-positive credit amount', async () => {
      const { svc } = build();
      await expect(svc.credit(userId, 0, TransactionType.REWARD)).rejects.toThrow(BadRequestException);
      await expect(svc.credit(userId, -5, TransactionType.REWARD)).rejects.toThrow(BadRequestException);
      await expect(svc.credit(userId, NaN, TransactionType.REWARD)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-positive debit amount', async () => {
      const { svc } = build();
      await expect(svc.debit(userId, 0, TransactionType.WITHDRAWAL)).rejects.toThrow(BadRequestException);
      await expect(svc.debit(userId, -1, TransactionType.WITHDRAWAL)).rejects.toThrow(BadRequestException);
    });

    it('rejects transfer with non-positive gross', async () => {
      const { svc } = build();
      await expect(
        svc.transfer(userId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, {
          payerType: TransactionType.BUTTON_SPEND,
          payeeType: TransactionType.BUTTON_PAYOUT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transfer when payer == payee', async () => {
      const { svc } = build();
      await expect(
        svc.transfer(userId, userId, 100, {
          payerType: TransactionType.DONATION_SENT,
          payeeType: TransactionType.DONATION_RECEIVED,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminAdjust', () => {
    it('rejects zero or non-finite delta', async () => {
      const { svc } = build();
      await expect(
        svc.adminAdjust({ userId, delta: 0, reason: 'noop', requesterId: 'staff' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        svc.adminAdjust({ userId, delta: NaN, reason: 'bad', requesterId: 'staff' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to mutate platform user balance', async () => {
      const { svc } = build();
      await expect(
        svc.adminAdjust({ userId: platformId, delta: 100, reason: 'meddling', requesterId: 'staff' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listTransactions', () => {
    it('clamps limit and decodes nextCursor when more results exist', async () => {
      const { svc, prisma } = build();
      const now = new Date('2025-01-01T00:00:00Z');
      prisma.transaction.findMany.mockResolvedValue([
        { id: 't1', type: TransactionType.DEPOSIT, amount: 10, balanceAfter: 10, description: null, ledgerGroupId: null, metadata: null, createdAt: now },
        { id: 't2', type: TransactionType.DEPOSIT, amount: 10, balanceAfter: 20, description: null, ledgerGroupId: null, metadata: null, createdAt: now },
        { id: 't3', type: TransactionType.DEPOSIT, amount: 10, balanceAfter: 30, description: null, ledgerGroupId: null, metadata: null, createdAt: now },
      ]);

      const res = await svc.listTransactions(userId, { limit: 2 });
      expect(res.items).toHaveLength(2);
      expect(res.nextCursor).toBe('t2');
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('returns null cursor when no more results', async () => {
      const { svc, prisma } = build();
      prisma.transaction.findMany.mockResolvedValue([]);
      const res = await svc.listTransactions(userId, {});
      expect(res.items).toEqual([]);
      expect(res.nextCursor).toBeNull();
    });
  });
});
