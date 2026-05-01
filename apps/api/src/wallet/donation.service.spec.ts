import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@botparty/prisma';
import { DonationService } from './donation.service';
import type { WalletService } from './wallet.service';
import type { PlatformUserService } from './platform-user.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

const platformId = '00000000-0000-0000-0000-00000000fee5';
const donorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ownerId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const robotId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function build() {
  const prisma = {
    robot: { findUnique: jest.fn() },
    walletIdempotencyKey: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;

  const redis = {
    incr: jest.fn().mockResolvedValue(1),
    incrby: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    decr: jest.fn().mockResolvedValue(0),
    decrby: jest.fn().mockResolvedValue(0),
  } as unknown as RedisService;

  const wallet = {
    transfer: jest.fn(),
  } as unknown as WalletService;

  const platform = {
    isPlatformUser: (id: string) => id === platformId,
  } as unknown as PlatformUserService;

  const svc = new DonationService(prisma, redis, wallet, platform);
  return {
    svc,
    prisma: prisma as unknown as { robot: { findUnique: jest.Mock }; walletIdempotencyKey: { findUnique: jest.Mock; create: jest.Mock } },
    redis: redis as unknown as { incr: jest.Mock; incrby: jest.Mock; expire: jest.Mock; decr: jest.Mock; decrby: jest.Mock },
    wallet: wallet as unknown as { transfer: jest.Mock },
  };
}

describe('DonationService', () => {
  it('rejects donations from the platform user', async () => {
    const { svc } = build();
    await expect(
      svc.donate({ donorId: platformId, robotId, amount: 100 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFound when robot does not exist', async () => {
    const { svc, prisma } = build();
    prisma.robot.findUnique.mockResolvedValue(null);
    await expect(
      svc.donate({ donorId, robotId, amount: 100 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects donating to your own robot', async () => {
    const { svc, prisma } = build();
    prisma.robot.findUnique.mockResolvedValue({ id: robotId, ownerId: donorId, name: 'Mine' });
    await expect(
      svc.donate({ donorId, robotId, amount: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns cached result when idempotency key already used', async () => {
    const { svc, prisma, wallet } = build();
    prisma.robot.findUnique.mockResolvedValue({ id: robotId, ownerId, name: 'Bot' });
    prisma.walletIdempotencyKey.findUnique.mockResolvedValue({
      result: { ledgerGroupId: 'reused', received: 90, fee: 10, recipientId: ownerId, donorBalanceAfter: 100 },
    });

    const res = await svc.donate({ donorId, robotId, amount: 100, idempotencyKey: 'idem-1' });
    expect(res).toMatchObject({ ledgerGroupId: 'reused' });
    expect(wallet.transfer).not.toHaveBeenCalled();
  });

  it('transfers via wallet with DONATION ledger types and persists idempotency on success', async () => {
    const { svc, prisma, wallet } = build();
    prisma.robot.findUnique.mockResolvedValue({ id: robotId, ownerId, name: 'Bot' });
    wallet.transfer.mockResolvedValue({
      ledgerGroupId: 'lg-1',
      payerBalanceAfter: 400,
      payeeBalanceAfter: 90,
      payeeReceived: 90,
      fee: 10,
    });

    const res = await svc.donate({
      donorId,
      robotId,
      amount: 100,
      message: 'thanks',
      idempotencyKey: 'idem-2',
    });

    expect(wallet.transfer).toHaveBeenCalledWith(
      donorId,
      ownerId,
      100,
      expect.objectContaining({
        payerType: TransactionType.DONATION_SENT,
        payeeType: TransactionType.DONATION_RECEIVED,
      }),
    );
    expect(prisma.walletIdempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: donorId, scope: 'donation', key: 'idem-2' }),
      }),
    );
    expect(res).toEqual({
      ledgerGroupId: 'lg-1',
      donorBalanceAfter: 400,
      recipientId: ownerId,
      received: 90,
      fee: 10,
    });
  });

  it('rolls back rate-limit accounting when transfer fails', async () => {
    const { svc, prisma, wallet, redis } = build();
    prisma.robot.findUnique.mockResolvedValue({ id: robotId, ownerId, name: 'Bot' });
    wallet.transfer.mockRejectedValue(new BadRequestException('fail'));

    await expect(svc.donate({ donorId, robotId, amount: 100 })).rejects.toThrow(BadRequestException);
    expect(redis.decr).toHaveBeenCalled();
    expect(redis.decrby).toHaveBeenCalledWith(expect.stringContaining(donorId), 100);
  });
});
