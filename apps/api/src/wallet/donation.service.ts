import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@botparty/prisma';
import { LIMITS } from '@botparty/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from './wallet.service';
import { PlatformUserService } from './platform-user.service';

const DONATION_RATE_HOUR_KEY = (userId: string) => `wallet:donations:hour:${userId}`;
const DONATION_DAILY_TOTAL_KEY = (userId: string) => `wallet:donations:dailytotal:${userId}`;

@Injectable()
export class DonationService {
  private readonly logger = new Logger(DonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
    private readonly platform: PlatformUserService,
  ) {}

  async donate(input: {
    donorId: string;
    robotId: string;
    amount: number;
    message?: string;
    idempotencyKey?: string;
    requestMeta?: { ip?: string; userAgent?: string };
  }) {
    const { donorId, robotId, amount, message, idempotencyKey, requestMeta } = input;

    if (this.platform.isPlatformUser(donorId)) {
      throw new ForbiddenException('Platform user cannot donate');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true, name: true },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId === donorId) {
      throw new BadRequestException({
        code: 'SELF_DONATION_FORBIDDEN',
        message: 'You cannot donate to your own robot',
      });
    }

    if (idempotencyKey) {
      const existing = await this.prisma.walletIdempotencyKey.findUnique({
        where: { userId_scope_key: { userId: donorId, scope: 'donation', key: idempotencyKey } },
      });
      if (existing?.result) {
        return existing.result as Record<string, unknown>;
      }
    }

    await this.enforceRateLimits(donorId, amount);

    const transferOrError = await this.wallet
      .transfer(donorId, robot.ownerId, amount, {
        payerType: TransactionType.DONATION_SENT,
        payeeType: TransactionType.DONATION_RECEIVED,
        description: `Donation to ${robot.name}`,
        metadata: {
          robotId: robot.id,
          robotName: robot.name,
          recipientId: robot.ownerId,
          message: message ?? null,
          ip: requestMeta?.ip ?? null,
          userAgent: requestMeta?.userAgent ?? null,
        } satisfies Prisma.InputJsonValue,
      })
      .catch((err) => err);

    if (transferOrError instanceof Error) {
      // Roll back rate-limit accounting for failed donations.
      await this.rollbackRateLimits(donorId, amount).catch(() => undefined);
      throw transferOrError;
    }

    const result = {
      ledgerGroupId: transferOrError.ledgerGroupId,
      donorBalanceAfter: transferOrError.payerBalanceAfter,
      recipientId: robot.ownerId,
      received: transferOrError.payeeReceived,
      fee: transferOrError.fee,
    };

    if (idempotencyKey) {
      await this.prisma.walletIdempotencyKey
        .create({
          data: {
            userId: donorId,
            scope: 'donation',
            key: idempotencyKey,
            result: result as Prisma.InputJsonValue,
          },
        })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002') {
            // Concurrent duplicate — fine, original wins.
            return;
          }
          throw err;
        });
    }

    return result;
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
