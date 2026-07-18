import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@botparty/prisma';
import type { InsufficientFundsError } from './wallet.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const platformId = '00000000-0000-0000-0000-00000000fee5';
  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const payeeId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function build() {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ balance: 100 }),
        update: jest.fn().mockResolvedValue({}),
      },
      transaction: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `tx-${data.type}`, ...data, createdAt: new Date(0) })),
      },
      controlCommand: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ balance: 100 }]),
      $executeRaw: jest.fn().mockResolvedValue(3),
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ balance: 250 }) },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
      controlCommand: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const platform = {
      getPlatformUserId: jest.fn().mockReturnValue(platformId),
      computeFee: jest.fn((gross: number) => Math.floor(gross * 0.1)),
      isPlatformUser: jest.fn((id: string) => id === platformId),
    };
    const service = new WalletService(prisma as never, platform as never);
    return { service, prisma, tx, platform };
  }

  it('returns a balance and rejects an unknown user', async () => {
    const found = build();
    await expect(found.service.getBalance(userId)).resolves.toBe(250);
    found.prisma.user.findUnique.mockResolvedValue(null);
    await expect(found.service.getBalance(userId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters, paginates, and assigns reconciliation ids to wallet history', async () => {
    const { service, prisma } = build();
    const date = new Date('2026-01-01T00:00:00Z');
    const base = { type: TransactionType.DEPOSIT, amount: 10, balanceAfter: 10, description: null, metadata: { robotId: 'r' }, createdAt: date };
    prisma.transaction.findMany.mockResolvedValue([
      { ...base, id: '1', billingIntentId: 'bill', payoutRequestId: 'pay', controlCommandId: 'cmd', ledgerGroupId: 'group' },
      { ...base, id: '2', billingIntentId: null, payoutRequestId: 'pay', controlCommandId: 'cmd', ledgerGroupId: 'group' },
      { ...base, id: '3', billingIntentId: null, payoutRequestId: null, controlCommandId: 'cmd', ledgerGroupId: 'group' },
      { ...base, id: '4', billingIntentId: null, payoutRequestId: null, controlCommandId: null, ledgerGroupId: 'group' },
      { ...base, id: '5', billingIntentId: null, payoutRequestId: null, controlCommandId: null, ledgerGroupId: null },
    ]);
    const from = new Date('2025-01-01');
    const to = new Date('2027-01-01');
    const result = await service.listTransactions(userId, { limit: 4, cursor: 'before', type: TransactionType.DEPOSIT, from, to, robotId: 'r' });
    expect(result.items.map((item) => item.reconciliationId)).toEqual(['bill', 'pay', 'cmd', 'group']);
    expect(result.items[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.nextCursor).toBe('4');
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId, type: TransactionType.DEPOSIT, createdAt: { gte: from, lte: to }, metadata: { path: ['robotId'], equals: 'r' } },
      cursor: { id: 'before' }, skip: 1, take: 5,
    }));
  });

  it('uses defaults, clamps the limit, and returns no cursor for an incomplete page', async () => {
    const { service, prisma } = build();
    prisma.transaction.findMany.mockResolvedValue([{ id: 'only', type: TransactionType.REWARD, amount: 1, balanceAfter: 1, description: null, ledgerGroupId: null, billingIntentId: null, payoutRequestId: null, controlCommandId: null, metadata: null, createdAt: new Date(0) }]);
    const result = await service.listTransactions(userId, { limit: 999 });
    expect(result.items[0]?.reconciliationId).toBe('only');
    expect(result.nextCursor).toBeNull();
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 201 }));
  });

  it('exports every history page until the cursor is exhausted', async () => {
    const { service } = build();
    jest.spyOn(service, 'listTransactions')
      .mockResolvedValueOnce({ items: [{ id: 'one' }] as never, nextCursor: 'one' })
      .mockResolvedValueOnce({ items: [{ id: 'two' }] as never, nextCursor: null });
    await expect(service.exportTransactions(userId, { type: TransactionType.REWARD })).resolves.toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(service.listTransactions).toHaveBeenNthCalledWith(2, userId, expect.objectContaining({ cursor: 'one', limit: 200 }));
  });

  it('lists stale pending control command ids with a bounded limit', async () => {
    const { service, prisma } = build();
    prisma.controlCommand.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const cutoff = new Date();
    await expect(service.listStaleReservedControlIds(cutoff, 7)).resolves.toEqual(['a', 'b']);
    expect(prisma.controlCommand.findMany).toHaveBeenCalledWith({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, select: { id: true }, take: 7 });
  });

  it.each([0, -1, Number.NaN])('rejects invalid credit amount %p', async (amount) => {
    await expect(build().service.credit(userId, amount, TransactionType.REWARD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([0, -1, Number.NaN])('rejects invalid debit amount %p', async (amount) => {
    await expect(build().service.debit(userId, amount, TransactionType.WITHDRAWAL)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('credits and debits inside serializable transactions with all reference fields', async () => {
    const { service, tx, prisma } = build();
    const options = {
      description: 'entry', metadata: { source: true }, ledgerGroupId: 'group', billingIntentId: 'bill', billingReversalKey: 'reverse', payoutRequestId: 'payout', controlCommandId: 'command',
    };
    await service.credit(userId, 10, TransactionType.REWARD, options);
    await service.debit(userId, 5, TransactionType.WITHDRAWAL, options);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.transaction.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ amount: 10, ...options }) }));
    expect(tx.transaction.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ amount: -5, ...options }) }));
  });

  it('stores database nulls for omitted descriptions, metadata, and references', async () => {
    const { service, tx } = build();
    await service.credit(userId, 1, TransactionType.REWARD);
    expect(tx.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      description: null, ledgerGroupId: null, billingIntentId: null, billingReversalKey: null, payoutRequestId: null, controlCommandId: null,
    }) }));
  });

  it.each([0, -1, Number.NaN])('rejects invalid transfer amount %p', async (gross) => {
    await expect(build().service.transfer(userId, payeeId, gross, { payerType: TransactionType.DONATION_SENT, payeeType: TransactionType.DONATION_RECEIVED })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a transfer to the payer', async () => {
    await expect(build().service.transfer(userId, userId, 10, { payerType: TransactionType.DONATION_SENT, payeeType: TransactionType.DONATION_RECEIVED })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('locks users in stable order and records payer, payee, and platform legs', async () => {
    const { service, tx } = build();
    const result = await service.transfer(userId, payeeId, 100, {
      payerType: TransactionType.DONATION_SENT,
      payeeType: TransactionType.DONATION_RECEIVED,
      description: 'donation', metadata: { robotId: 'robot' }, controlCommandId: 'command',
    });
    expect(result).toEqual(expect.objectContaining({ payerBalanceAfter: 100, payeeBalanceAfter: 100, payeeReceived: 90, fee: 10 }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.transaction.create).toHaveBeenCalledTimes(3);
    expect(tx.transaction.create).toHaveBeenNthCalledWith(3, expect.objectContaining({ data: expect.objectContaining({ userId: platformId, type: TransactionType.PLATFORM_FEE, amount: 10 }) }));
  });

  it('skips the platform leg for a fee-free transfer and honors an existing ledger group', async () => {
    const { service, tx, platform } = build();
    platform.computeFee.mockReturnValue(0);
    const result = await service.transferInTransaction(tx as never, userId, payeeId, 100, {
      payerType: TransactionType.DONATION_SENT, payeeType: TransactionType.DONATION_RECEIVED, ledgerGroupId: 'fixed',
    });
    expect(result).toEqual({ ledgerGroupId: 'fixed', payerBalanceAfter: 100, payeeBalanceAfter: 100, payeeReceived: 100, fee: 0 });
    expect(tx.transaction.create).toHaveBeenCalledTimes(2);
  });

  it('creates debt and a financial hold when a billing reversal exceeds balance', async () => {
    const { service, tx } = build();
    tx.user.findUnique.mockResolvedValue({ balance: 40 });
    await service.reverseBillingCreditInTransaction(tx as never, {
      userId, amount: 100, type: TransactionType.CHARGEBACK, reversalKey: 'reversal', billingIntentId: 'bill', metadata: { event: 'e' },
    });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: userId }, data: { creditDebt: { increment: 60 }, financialHold: true } });
    expect(tx.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: -40, billingReversalKey: 'reversal', metadata: expect.objectContaining({ debtCreated: 60 }) }) }));
  });

  it('handles a full-balance and zero-balance billing reversal', async () => {
    const full = build();
    full.tx.user.findUnique.mockResolvedValue({ balance: 200 });
    await full.service.reverseBillingCreditInTransaction(full.tx as never, { userId, amount: 100, type: TransactionType.REFUND, reversalKey: 'r1', billingIntentId: 'b', metadata: {} });
    expect(full.tx.user.update).not.toHaveBeenCalled();

    const zero = build();
    zero.tx.user.findUnique.mockResolvedValue({ balance: 0 });
    await zero.service.reverseBillingCreditInTransaction(zero.tx as never, { userId, amount: 100, type: TransactionType.REFUND, reversalKey: 'r2', billingIntentId: 'b', metadata: {} });
    expect(zero.tx.$queryRaw).not.toHaveBeenCalled();
    expect(zero.tx.user.update).toHaveBeenCalled();
  });

  it('rejects a billing reversal for an unknown user', async () => {
    const { service, tx } = build();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(service.reverseBillingCreditInTransaction(tx as never, { userId, amount: 1, type: TransactionType.REFUND, reversalKey: 'r', billingIntentId: 'b', metadata: {} })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('completes reserved control payout and fee legs', async () => {
    const { service, tx } = build();
    await expect(service.completeReservedControlInTransaction(tx as never, { payeeId, gross: 100, ledgerGroupId: 'group', controlCommandId: 'command', metadata: { button: 'b' } })).resolves.toEqual({ payeeBalanceAfter: 100, received: 90, fee: 10 });
    expect(tx.transaction.create).toHaveBeenCalledTimes(2);
  });

  it('completes a fee-free reserved control with one ledger leg', async () => {
    const { service, tx, platform } = build();
    platform.computeFee.mockReturnValue(0);
    await service.completeReservedControlInTransaction(tx as never, { payeeId, gross: 100, ledgerGroupId: 'group', controlCommandId: 'command', metadata: {} });
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
  });

  it('compensates an unacknowledged control through the refund ledger', async () => {
    const { service, tx } = build();
    await service.compensateReservedControlInTransaction(tx as never, { userId, amount: 12, controlCommandId: 'command', sourceLedgerGroupId: 'source' });
    expect(tx.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: TransactionType.REFUND, amount: 12, controlCommandId: 'command' }) }));
  });

  it('uses default and explicit refund descriptions', async () => {
    const { service } = build();
    const credit = jest.spyOn(service, 'credit').mockResolvedValue({} as never);
    await service.refund(userId, 5, 'source');
    await service.refund(userId, 6, 'source2', TransactionType.REWARD, 'manual');
    expect(credit).toHaveBeenNthCalledWith(1, userId, 5, TransactionType.REFUND, expect.objectContaining({ description: 'Refund of source' }));
    expect(credit).toHaveBeenNthCalledWith(2, userId, 6, TransactionType.REWARD, expect.objectContaining({ description: 'manual' }));
  });

  it.each([0, Number.NaN])('rejects invalid admin adjustment %p', async (delta) => {
    await expect(build().service.adminAdjust({ userId, delta, reason: 'bad', requesterId: 'staff' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects platform adjustment and dispatches positive and negative adjustments', async () => {
    const blocked = build();
    await expect(blocked.service.adminAdjust({ userId: platformId, delta: 1, reason: 'bad', requesterId: 'staff' })).rejects.toBeInstanceOf(ForbiddenException);

    const { service, tx } = build();
    const credit = jest.spyOn(service, 'creditInTransaction').mockResolvedValue({} as never);
    const debit = jest.spyOn(service, 'debitInTransaction').mockResolvedValue({} as never);
    await service.adminAdjust({ userId, delta: 5, reason: 'grant', requesterId: 'staff' });
    await service.adminAdjust({ userId, delta: -7, reason: 'remove', requesterId: 'staff' });
    expect(credit).toHaveBeenCalledWith(tx, userId, 5, TransactionType.ADMIN_ADJUSTMENT, expect.any(Object));
    expect(debit).toHaveBeenCalledWith(tx, userId, 7, TransactionType.ADMIN_ADJUSTMENT, expect.any(Object));
  });

  it('reports not-found and insufficient-funds outcomes from guarded balance updates', async () => {
    const creditMissing = build();
    creditMissing.tx.$queryRaw.mockResolvedValue([]);
    await expect(creditMissing.service.creditInTransaction(creditMissing.tx as never, userId, 1, TransactionType.REWARD)).rejects.toBeInstanceOf(NotFoundException);

    const debitMissing = build();
    debitMissing.tx.$queryRaw.mockResolvedValue([]);
    debitMissing.tx.user.findUnique.mockResolvedValue(null);
    await expect(debitMissing.service.debitInTransaction(debitMissing.tx as never, userId, 5, TransactionType.WITHDRAWAL)).rejects.toBeInstanceOf(NotFoundException);

    const insufficient = build();
    insufficient.tx.$queryRaw.mockResolvedValue([]);
    insufficient.tx.user.findUnique.mockResolvedValue({ balance: 3 });
    await expect(insufficient.service.debitInTransaction(insufficient.tx as never, userId, 5, TransactionType.WITHDRAWAL)).rejects.toEqual(expect.objectContaining<Partial<InsufficientFundsError>>({ required: 5, balance: 3 }));
  });

  it('handles a zero delta and rejects an unknown zero-delta user', async () => {
    const found = build();
    await expect((found.service as never as { applyDelta(tx: unknown, id: string, delta: number): Promise<number> }).applyDelta(found.tx, userId, 0)).resolves.toBe(100);
    found.tx.user.findUnique.mockResolvedValue(null);
    await expect((found.service as never as { applyDelta(tx: unknown, id: string, delta: number): Promise<number> }).applyDelta(found.tx, userId, 0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retries serialization and deadlock failures, then succeeds', async () => {
    const { service, prisma } = build();
    prisma.$transaction
      .mockRejectedValueOnce({ code: '40001' })
      .mockRejectedValueOnce({ code: '40P01' })
      .mockResolvedValueOnce('ok');
    await expect(service.runSerializable(async () => 'unused')).resolves.toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('stops after the retry budget and does not retry unrelated failures', async () => {
    const exhausted = build();
    const serialization = Object.assign(new Error('serialization'), { code: '40001' });
    exhausted.prisma.$transaction.mockRejectedValue(serialization);
    await expect(exhausted.service.runSerializable(async () => null)).rejects.toBe(serialization);
    expect(exhausted.prisma.$transaction).toHaveBeenCalledTimes(4);

    const unrelated = build();
    const failure = new Error('offline');
    unrelated.prisma.$transaction.mockRejectedValue(failure);
    await expect(unrelated.service.runSerializable(async () => null)).rejects.toBe(failure);
    expect(unrelated.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
