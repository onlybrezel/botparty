import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@botparty/prisma';
import { LIMITS } from '@botparty/shared';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from './wallet.service';
import { PlatformUserService } from './platform-user.service';
type DonationDatabase = {
  robot: Pick<PrismaService['robot'], 'findUnique'>;
  walletIdempotencyKey: Pick<PrismaService['walletIdempotencyKey'], 'findUnique'>;
};
type DonationTransaction = {
  walletIdempotencyKey: Pick<Prisma.TransactionClient['walletIdempotencyKey'], 'create' | 'update'>;
};
interface DonationWallet {
  runSerializable<T>(fn: (tx: DonationTransaction) => Promise<T>): Promise<T>;
  transferInTransaction(
    tx: DonationTransaction,
    fromUserId: string,
    toUserId: string,
    amount: number,
    options: Parameters<WalletService['transferInTransaction']>[4],
  ): ReturnType<WalletService['transferInTransaction']>;
}
import { FeatureFlagsService } from '../common/feature-flags.service';

const DONATION_RATE_HOUR_KEY = (userId: string) => `wallet:donations:hour:${userId}`;
const DONATION_DAILY_TOTAL_KEY = (userId: string) => `wallet:donations:dailytotal:${userId}`;

@Injectable()
export class DonationService {
  private readonly logger = new Logger(DonationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: DonationDatabase,
    @Inject(RedisService) private readonly redis: Pick<RedisService, 'decr' | 'decrby' | 'expire' | 'incr' | 'incrby'>,
    @Inject(WalletService) private readonly wallet: DonationWallet,
    @Inject(PlatformUserService) private readonly platform: Pick<PlatformUserService, 'isPlatformUser'>,
    @Inject(FeatureFlagsService) private readonly features: Pick<FeatureFlagsService, 'assertEnabled'>,
  ) {}

  async donate(input: {
    donorId: string;
    robotId: string;
    amount: number;
    message?: string;
    idempotencyKey?: string;
  }) {
    const { donorId, robotId, amount, message, idempotencyKey } = input;
    this.features.assertEnabled('DONATIONS');
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key is required for donations.',
      });
    }
    const normalizedKey = idempotencyKey.trim();

    if (this.platform.isPlatformUser(donorId)) {
      throw new ForbiddenException('Platform user cannot donate');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true, name: true, visibility: true },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.visibility === 'PRIVATE' && robot.ownerId !== donorId) {
      throw new NotFoundException('Robot not found');
    }
    if (robot.ownerId === donorId) {
      throw new BadRequestException({
        code: 'SELF_DONATION_FORBIDDEN',
        message: 'You cannot donate to your own robot',
      });
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ donorId, robotId, amount, message: message?.trim() ?? null }))
      .digest('hex');
    const existing = await this.prisma.walletIdempotencyKey.findUnique({
      where: { userId_scope_key: { userId: donorId, scope: 'donation', key: normalizedKey } },
    });
    if (existing) {
      return this.resolveExisting(existing, requestHash);
    }

    await this.enforceRateLimits(donorId, amount);

    const transferOutcome = await this.wallet
      .runSerializable(async (tx) => {
        const reservation = await tx.walletIdempotencyKey.create({
          data: {
            userId: donorId,
            scope: 'donation',
            key: normalizedKey,
            requestHash,
            status: 'IN_PROGRESS',
          },
        });
        const transfer = await this.wallet.transferInTransaction(
          tx,
          donorId,
          robot.ownerId,
          amount,
          {
            payerType: TransactionType.DONATION_SENT,
            payeeType: TransactionType.DONATION_RECEIVED,
            description: `Donation to ${robot.name}`,
            metadata: {
              robotId: robot.id,
              robotName: robot.name,
              recipientId: robot.ownerId,
              message: message?.trim() ?? null,
            } satisfies Prisma.InputJsonValue,
          },
        );
        const result = {
          ledgerGroupId: transfer.ledgerGroupId,
          donorBalanceAfter: transfer.payerBalanceAfter,
          recipientId: robot.ownerId,
          received: transfer.payeeReceived,
          fee: transfer.fee,
        };
        await tx.walletIdempotencyKey.update({
          where: { id: reservation.id },
          data: {
            transactionId: transfer.ledgerGroupId,
            status: 'COMPLETED',
            result: result as Prisma.InputJsonValue,
          },
        });
        return result;
      })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }));

    if (!transferOutcome.ok) {
      const transferError = transferOutcome.error;
      try {
        await this.rollbackRateLimits(donorId, amount);
      } catch (rollbackError) {
        this.logger.warn(
          `Failed to roll back donation rate-limit reservation: ${(rollbackError as Error).message}`,
        );
      }
      if ((transferError as { code?: string } | null)?.code === 'P2002') {
        const winner = await this.prisma.walletIdempotencyKey.findUnique({
          where: { userId_scope_key: { userId: donorId, scope: 'donation', key: normalizedKey } },
        });
        if (winner) return this.resolveExisting(winner, requestHash);
      }
      throw transferError;
    }
    return transferOutcome.value;
  }

  private resolveExisting(
    existing: { requestHash: string; status: string; result: Prisma.JsonValue | null },
    requestHash: string,
  ) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key belongs to a different donation request.',
      });
    }
    if (existing.status === 'COMPLETED' && existing.result) {
      return existing.result as Record<string, unknown>;
    }
    throw new ConflictException({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      message: 'The donation is still being processed.',
    });
  }

  private async enforceRateLimits(userId: string, amount: number) {
    const hourKey = DONATION_RATE_HOUR_KEY(userId);
    const dailyKey = DONATION_DAILY_TOTAL_KEY(userId);

    const count = await this.redis.incr(hourKey);
    if (count === 1) {
      await this.redis.expire(hourKey, 3600);
    }
    if (count > LIMITS.DONATIONS_PER_HOUR) {
      throw new ConflictException({
        code: 'RATE_LIMITED',
        message: 'Too many donations in the last hour',
      });
    }

    const total = await this.redis.incrby(dailyKey, amount);
    if (total === amount) {
      await this.redis.expire(dailyKey, 86400);
    }
    if (total > LIMITS.DONATIONS_DAILY_CAP_CREDITS) {
      throw new ConflictException({
        code: 'DAILY_CAP_EXCEEDED',
        message: 'Daily donation cap reached',
      });
    }
  }

  private async rollbackRateLimits(userId: string, amount: number) {
    await this.redis.decr(DONATION_RATE_HOUR_KEY(userId));
    await this.redis.decrby(DONATION_DAILY_TOTAL_KEY(userId), amount);
  }
}
