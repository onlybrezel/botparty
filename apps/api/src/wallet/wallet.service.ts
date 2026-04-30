import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
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

export class SelfDonationError extends BadRequestException {
  constructor() {
    super({ code: 'SELF_DONATION_FORBIDDEN', message: 'You cannot donate to yourself' });
  }
}

export interface TransferResult {
  ledgerGroupId: string;
  payerBalanceAfter: number;
  payeeBalanceAfter: number;
  payeeReceived: number;
  fee: number;
}

interface CreditDebitOptions {
  description?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ledgerGroupId?: string;
}

interface TransferOptions extends CreditDebitOptions {
  payerType: TransactionType;
  payeeType: TransactionType;
}

const SERIALIZATION_ERROR_CODES = new Set(['40001', '40P01']);
const MAX_RETRIES = 3;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformUserService,
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
    opts: { limit?: number; cursor?: string; type?: TransactionType } = {},
  ) {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const where: Prisma.TransactionWhereInput = { userId };
    if (opts.type) where.type = opts.type;

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
        metadata: true,
        createdAt: true,
      },
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;

    return {
      items: sliced.map((tx) => ({
        ...tx,
        createdAt: tx.createdAt.toISOString(),
        metadata: (tx.metadata as Record<string, unknown> | null) ?? null,
      })),
      nextCursor: hasMore && sliced.length > 0 ? sliced[sliced.length - 1]!.id : null,
    };
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
    return this.runRetryable(async () => {
      return this.prisma.$transaction(async (tx) => {
        const balanceAfter = await this.applyDelta(tx, userId, amount);
        return this.recordTransaction(tx, {
          userId,
          type,
          amount,
          balanceAfter,
          description: opts.description ?? null,
          metadata: opts.metadata ?? null,
          ledgerGroupId: opts.ledgerGroupId,
        });
      });
    });
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
    return this.runRetryable(async () => {
      return this.prisma.$transaction(async (tx) => {
        const balanceAfter = await this.applyDelta(tx, userId, -amount);
        return this.recordTransaction(tx, {
          userId,
          type,
          amount: -amount,
          balanceAfter,
          description: opts.description ?? null,
          metadata: opts.metadata ?? null,
          ledgerGroupId: opts.ledgerGroupId,
        });
      });
    });
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

    const platformId = this.platform.getPlatformUserId();
    const fee = this.platform.computeFee(gross);
    const payeeReceived = gross - fee;
    const ledgerGroupId = randomUUID();

    return this.runRetryable(async () => {
      return this.prisma.$transaction(async (tx) => {
        // Lock rows in deterministic order to prevent deadlocks.
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
          });
        }

        return {
          ledgerGroupId,
          payerBalanceAfter,
          payeeBalanceAfter,
          payeeReceived,
          fee,
        };
      });
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
    const { userId, delta, reason, requesterId } = input;
    if (!Number.isFinite(delta) || delta === 0) {
      throw new BadRequestException('Adjustment delta must be non-zero');
    }
    if (this.platform.isPlatformUser(userId)) {
      throw new ForbiddenException('Cannot adjust platform user balance directly');
    }

    const meta: Prisma.InputJsonValue = { reason, requesterId, kind: 'admin_adjustment' };
    if (delta > 0) {
      return this.credit(userId, delta, TransactionType.ADMIN_ADJUSTMENT, {
        description: `Admin adjustment (+${delta})`,
        metadata: meta,
      });
    }
    return this.debit(userId, Math.abs(delta), TransactionType.ADMIN_ADJUSTMENT, {
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
  private async applyDelta(
    tx: Prisma.TransactionClient,
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
      if (rows.length === 0) throw new NotFoundException('User not found');
      return rows[0]!.balance;
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
    return rows[0]!.balance;
  }

  private async recordTransaction(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      type: TransactionType;
      amount: number;
      balanceAfter: number;
      description: string | null;
      metadata: Prisma.InputJsonValue | null;
      ledgerGroupId?: string;
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

  private async runRetryable<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
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
}
