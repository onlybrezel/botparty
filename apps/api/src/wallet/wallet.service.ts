import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@botparty/prisma';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformUserService } from './platform-user.service';

export class InsufficientFundsError extends BadRequestException {
  constructor(public readonly required: number, public readonly balance: number) {
    super({ code: 'INSUFFICIENT_FUNDS', required, balance, message: 'Insufficient credits' });
  }
}

interface TransferResult {
  ledgerGroupId: string;
  payerBalanceAfter: number;
  payeeBalanceAfter: number;
  payeeReceived: number;
  fee: number;
}

interface CreditDebitOptions {
  description?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ledgerGroupId?: string | undefined;
  billingIntentId?: string | undefined;
  billingReversalKey?: string | undefined;
  payoutRequestId?: string | undefined;
  controlCommandId?: string | undefined;
}

interface TransferOptions extends CreditDebitOptions {
  payerType: TransactionType;
  payeeType: TransactionType;
}

export type WalletTransaction = {
  $executeRaw: Prisma.TransactionClient['$executeRaw'];
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  adminAuditLog: Pick<Prisma.TransactionClient['adminAuditLog'], 'create'>;
  billingIntent: Pick<Prisma.TransactionClient['billingIntent'], 'findFirst' | 'findUniqueOrThrow' | 'update'>;
  billingWebhookEvent: Pick<Prisma.TransactionClient['billingWebhookEvent'], 'create'>;
  controlCommand: Pick<Prisma.TransactionClient['controlCommand'], 'create' | 'findMany' | 'findUnique' | 'update'>;
  payoutRequest: Pick<
    Prisma.TransactionClient['payoutRequest'],
    'create' | 'findFirst' | 'findUnique' | 'findUniqueOrThrow' | 'update' | 'updateMany'
  >;
  robot: Pick<Prisma.TransactionClient['robot'], 'findUnique'>;
  transaction: Pick<Prisma.TransactionClient['transaction'], 'create' | 'findUnique'>;
  user: Pick<Prisma.TransactionClient['user'], 'findUnique' | 'update'>;
  walletIdempotencyKey: Pick<Prisma.TransactionClient['walletIdempotencyKey'], 'create' | 'update'>;
};

interface WalletDatabase {
  $transaction<T>(
    callback: (transaction: WalletTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
  controlCommand: Pick<PrismaService['controlCommand'], 'findMany'>;
  transaction: Pick<PrismaService['transaction'], 'findMany'>;
  user: Pick<PrismaService['user'], 'findUnique'>;
}

const SERIALIZATION_ERROR_CODES = new Set(['40001', '40P01']);
const MAX_RETRIES = 3;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: WalletDatabase,
    @Inject(PlatformUserService)
    private readonly platform: Pick<PlatformUserService, 'computeFee' | 'getPlatformUserId' | 'isPlatformUser'>,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.balance;
  }

  async listTransactions(
    userId: string,
    opts: { limit?: number; cursor?: string; type?: TransactionType; from?: Date; to?: Date; robotId?: string } = {},
  ) {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const where: Prisma.TransactionWhereInput = { userId };
    if (opts.type) where.type = opts.type;
    if (opts.from || opts.to) {
      where.createdAt = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
    }
    if (opts.robotId) where.metadata = { path: ['robotId'], equals: opts.robotId };

    const items = await this.prisma.transaction.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        ledgerGroupId: true,
        billingIntentId: true,
        payoutRequestId: true,
        controlCommandId: true,
        metadata: true,
        createdAt: true,
      },
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;

    return {
      items: sliced.map((tx) => ({
        ...tx,
        reconciliationId: tx.billingIntentId ?? tx.payoutRequestId ?? tx.controlCommandId ?? tx.ledgerGroupId ?? tx.id,
        createdAt: tx.createdAt.toISOString(),
        metadata: (tx.metadata as Record<string, unknown> | null) ?? null,
      })),
      nextCursor: hasMore ? sliced.at(-1)?.id ?? null : null,
    };
  }

  async exportTransactions(
    userId: string,
    opts: { type?: TransactionType; from?: Date; to?: Date; robotId?: string },
  ) {
    const all = [];
    let cursor: string | undefined;
    do {
      const page = await this.listTransactions(userId, {
        ...opts,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 200,
      });
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
  }

  async listStaleReservedControlIds(olderThan: Date, limit = 500): Promise<string[]> {
    const commands = await this.prisma.controlCommand.findMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      select: { id: true },
      take: limit,
    });
    return commands.map((command) => command.id);
  }

  // ─── Single-leg helpers ──────────────────────────────────────────────────────

  /** Atomically credit a user's balance and write a Transaction row. */
  async credit(
    userId: string,
    amount: number,
    type: TransactionType,
    opts: CreditDebitOptions = {},
  ) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Credit amount must be positive');
    }
    return this.runSerializable((tx) => this.creditInTransaction(tx, userId, amount, type, opts));
  }

  /** Atomically debit a user's balance with a balance-guard update. */
  async debit(
    userId: string,
    amount: number,
    type: TransactionType,
    opts: CreditDebitOptions = {},
  ) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Debit amount must be positive');
    }
    return this.runSerializable((tx) => this.debitInTransaction(tx, userId, amount, type, opts));
  }

  // ─── Transfer with platform fee ──────────────────────────────────────────────

  /**
   * Atomically transfers `gross` credits from payer to payee, splitting off the
   * platform fee. Writes three Transaction rows tagged with a shared ledgerGroupId.
   *
   * Locking order is by ascending user id to avoid deadlocks. Caller must not
   * pass payer == payee; that case is validated before scheduling.
   */
  async transfer(
    payerId: string,
    payeeId: string,
    gross: number,
    options: TransferOptions,
  ): Promise<TransferResult> {
    if (!Number.isFinite(gross) || gross <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    if (payerId === payeeId) {
      throw new BadRequestException('Payer and payee must differ');
    }

    const ledgerGroupId = randomUUID();
    return this.runSerializable((tx) =>
      this.transferInTransaction(tx, payerId, payeeId, gross, { ...options, ledgerGroupId }),
    );
  }

  async creditInTransaction(
    tx: WalletTransaction,
    userId: string,
    amount: number,
    type: TransactionType,
    opts: CreditDebitOptions = {},
  ) {
    const balanceAfter = await this.applyDelta(tx, userId, amount);
    return this.recordTransaction(tx, {
      userId,
      type,
      amount,
      balanceAfter,
      description: opts.description ?? null,
      metadata: opts.metadata ?? null,
      ...this.referenceFields(opts),
    });
  }

  async debitInTransaction(
    tx: WalletTransaction,
    userId: string,
    amount: number,
    type: TransactionType,
    opts: CreditDebitOptions = {},
  ) {
    const balanceAfter = await this.applyDelta(tx, userId, -amount);
    return this.recordTransaction(tx, {
      userId,
      type,
      amount: -amount,
      balanceAfter,
      description: opts.description ?? null,
      metadata: opts.metadata ?? null,
      ...this.referenceFields(opts),
    });
  }

  async reverseBillingCreditInTransaction(
    tx: WalletTransaction,
    input: {
      userId: string;
      amount: number;
      type: 'REFUND' | 'CHARGEBACK';
      reversalKey: string;
      billingIntentId: string;
      metadata: Record<string, Prisma.JsonValue>;
    },
  ) {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { balance: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const debited = Math.min(user.balance, input.amount);
    const debt = input.amount - debited;
    const balanceAfter = debited > 0
      ? await this.applyDelta(tx, input.userId, -debited)
      : user.balance;
    if (debt > 0) {
      await tx.user.update({
        where: { id: input.userId },
        data: { creditDebt: { increment: debt }, financialHold: true },
      });
    }
    return this.recordTransaction(tx, {
      userId: input.userId,
      type: input.type,
      amount: -debited,
      balanceAfter,
      description: `${input.type === TransactionType.REFUND ? 'Refund' : 'Chargeback'} reversal`,
      metadata: {
        ...input.metadata,
        requestedDebit: input.amount,
        debtCreated: debt,
      },
      billingReversalKey: input.reversalKey,
    });
  }

  async transferInTransaction(
    tx: WalletTransaction,
    payerId: string,
    payeeId: string,
    gross: number,
    options: TransferOptions,
  ): Promise<TransferResult> {
    const platformId = this.platform.getPlatformUserId();
    const fee = this.platform.computeFee(gross);
    const payeeReceived = gross - fee;
    const ledgerGroupId = options.ledgerGroupId ?? randomUUID();
    const ids = [payerId, payeeId, platformId].sort();
    await tx.$executeRaw(
      Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(
        ids.map((id) => Prisma.sql`${id}::uuid`),
      )}) ORDER BY id FOR UPDATE`,
    );

    const payerBalanceAfter = await this.applyDelta(tx, payerId, -gross);
    await this.recordTransaction(tx, {
      userId: payerId,
      type: options.payerType,
      amount: -gross,
      balanceAfter: payerBalanceAfter,
      description: options.description ?? null,
      metadata: options.metadata ?? null,
      ledgerGroupId,
      controlCommandId: options.controlCommandId,
    });
    const payeeBalanceAfter = await this.applyDelta(tx, payeeId, payeeReceived);
    await this.recordTransaction(tx, {
      userId: payeeId,
      type: options.payeeType,
      amount: payeeReceived,
      balanceAfter: payeeBalanceAfter,
      description: options.description ?? null,
      metadata: options.metadata ?? null,
      ledgerGroupId,
      controlCommandId: options.controlCommandId,
    });
    if (fee > 0) {
      const platformBalanceAfter = await this.applyDelta(tx, platformId, fee);
      await this.recordTransaction(tx, {
        userId: platformId,
        type: TransactionType.PLATFORM_FEE,
        amount: fee,
        balanceAfter: platformBalanceAfter,
        description: options.description ?? null,
        metadata: options.metadata ?? null,
        ledgerGroupId,
        controlCommandId: options.controlCommandId,
      });
    }
    return { ledgerGroupId, payerBalanceAfter, payeeBalanceAfter, payeeReceived, fee };
  }

  async completeReservedControlInTransaction(
    tx: WalletTransaction,
    input: {
      payeeId: string;
      gross: number;
      ledgerGroupId: string;
      controlCommandId: string;
      metadata: Prisma.InputJsonValue;
    },
  ) {
    const platformId = this.platform.getPlatformUserId();
    const fee = this.platform.computeFee(input.gross);
    const received = input.gross - fee;
    const payeeBalanceAfter = await this.applyDelta(tx, input.payeeId, received);
    await this.recordTransaction(tx, {
      userId: input.payeeId,
      type: TransactionType.BUTTON_PAYOUT,
      amount: received,
      balanceAfter: payeeBalanceAfter,
      description: 'Paid control completed',
      metadata: input.metadata,
      ledgerGroupId: input.ledgerGroupId,
      controlCommandId: input.controlCommandId,
    });
    if (fee > 0) {
      const platformBalanceAfter = await this.applyDelta(tx, platformId, fee);
      await this.recordTransaction(tx, {
        userId: platformId,
        type: TransactionType.PLATFORM_FEE,
        amount: fee,
        balanceAfter: platformBalanceAfter,
        description: 'Paid control platform fee',
        metadata: input.metadata,
        ledgerGroupId: input.ledgerGroupId,
        controlCommandId: input.controlCommandId,
      });
    }
    return { payeeBalanceAfter, received, fee };
  }

  async compensateReservedControlInTransaction(
    tx: WalletTransaction,
    input: { userId: string; amount: number; controlCommandId: string; sourceLedgerGroupId: string },
  ) {
    return this.creditInTransaction(tx, input.userId, input.amount, TransactionType.REFUND, {
      controlCommandId: input.controlCommandId,
      description: 'Paid control was not acknowledged',
      metadata: { sourceLedgerGroupId: input.sourceLedgerGroupId, controlCommandId: input.controlCommandId },
    });
  }

  // ─── Refund (reverse) ────────────────────────────────────────────────────────

  /**
   * Reverses a debit (e.g. cooldown lost after wallet commit). Uses a fresh
   * ledger group to keep the original event auditable; description references
   * the source group for traceability.
   */
  async refund(
    userId: string,
    amount: number,
    sourceLedgerGroupId: string,
    type: TransactionType = TransactionType.REFUND,
    description?: string,
  ) {
    return this.credit(userId, amount, type, {
      description: description ?? `Refund of ${sourceLedgerGroupId}`,
      metadata: { sourceLedgerGroupId },
    });
  }

  // ─── Admin adjustment ────────────────────────────────────────────────────────

  /**
   * Staff-initiated balance adjustment. Logs through the ledger so balances are
   * always reconcilable. Refuses to mutate the platform user.
   */
  async adminAdjust(input: {
    userId: string;
    delta: number;
    reason: string;
    requesterId: string;
  }) {
    return this.runSerializable((tx) => this.adminAdjustInTransaction(tx, input));
  }

  async adminAdjustInTransaction(
    tx: WalletTransaction,
    input: {
      userId: string;
      delta: number;
      reason: string;
      requesterId: string;
    },
  ) {
    const { userId, delta, reason, requesterId } = input;
    if (!Number.isFinite(delta) || delta === 0) {
      throw new BadRequestException('Adjustment delta must be non-zero');
    }
    if (this.platform.isPlatformUser(userId)) {
      throw new ForbiddenException('Cannot adjust platform user balance directly');
    }

    const meta: Prisma.InputJsonValue = { reason, requesterId, kind: 'admin_adjustment' };
    if (delta > 0) {
      return this.creditInTransaction(tx, userId, delta, TransactionType.ADMIN_ADJUSTMENT, {
        description: `Admin adjustment (+${delta})`,
        metadata: meta,
      });
    }
    return this.debitInTransaction(tx, userId, Math.abs(delta), TransactionType.ADMIN_ADJUSTMENT, {
      description: `Admin adjustment (${delta})`,
      metadata: meta,
    });
  }

  // ─── Internal primitives ─────────────────────────────────────────────────────

  /**
   * Apply a balance delta inside an open transaction. For debits, uses a
   * conditional UPDATE that fails the transaction with InsufficientFundsError
   * when the balance would go negative.
   */
  async applyDelta(
    tx: WalletTransaction,
    userId: string,
    delta: number,
  ): Promise<number> {
    if (delta === 0) {
      const current = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
      if (!current) throw new NotFoundException('User not found');
      return current.balance;
    }

    if (delta > 0) {
      const rows = await tx.$queryRaw<Array<{ balance: number }>>(
        Prisma.sql`UPDATE users SET balance = balance + ${delta}, "updatedAt" = NOW()
                   WHERE id = ${userId}::uuid
                   RETURNING balance`,
      );
      const updated = rows[0];
      if (!updated) throw new NotFoundException('User not found');
      return updated.balance;
    }

    // Debit path: guarded conditional update.
    const need = Math.abs(delta);
    const rows = await tx.$queryRaw<Array<{ balance: number }>>(
      Prisma.sql`UPDATE users SET balance = balance - ${need}, "updatedAt" = NOW()
                 WHERE id = ${userId}::uuid AND balance >= ${need}
                 RETURNING balance`,
    );
    if (rows.length === 0) {
      const existing = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
      if (!existing) throw new NotFoundException('User not found');
      throw new InsufficientFundsError(need, existing.balance);
    }
    const updated = rows[0];
    if (!updated) throw new NotFoundException('User not found');
    return updated.balance;
  }

  private async recordTransaction(
    tx: WalletTransaction,
    input: {
      userId: string;
      type: TransactionType;
      amount: number;
      balanceAfter: number;
      description: string | null;
      metadata: Prisma.InputJsonValue | null;
      ledgerGroupId?: string | undefined;
      billingIntentId?: string | undefined;
      billingReversalKey?: string | undefined;
      payoutRequestId?: string | undefined;
      controlCommandId?: string | undefined;
    },
  ) {
    return tx.transaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        balanceAfter: input.balanceAfter,
        description: input.description ?? null,
        metadata: input.metadata ?? Prisma.DbNull,
        ledgerGroupId: input.ledgerGroupId ?? null,
        billingIntentId: input.billingIntentId ?? null,
        billingReversalKey: input.billingReversalKey ?? null,
        payoutRequestId: input.payoutRequestId ?? null,
        controlCommandId: input.controlCommandId ?? null,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        ledgerGroupId: true,
        createdAt: true,
      },
    });
  }

  async runSerializable<T>(fn: (tx: WalletTransaction) => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code && SERIALIZATION_ERROR_CODES.has(code) && attempt < MAX_RETRIES) {
          attempt += 1;
          this.logger.warn(`Retrying wallet operation after serialization error ${code}`);
          await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  private referenceFields(opts: CreditDebitOptions) {
    return {
      ledgerGroupId: opts.ledgerGroupId,
      billingIntentId: opts.billingIntentId,
      billingReversalKey: opts.billingReversalKey,
      payoutRequestId: opts.payoutRequestId,
      controlCommandId: opts.controlCommandId,
    };
  }
}
