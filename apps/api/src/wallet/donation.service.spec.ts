import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionType } from '@botparty/prisma';
import { LIMITS } from '@botparty/shared';
import { createHash } from 'crypto';
import { DonationService } from './donation.service';

const platformId = '00000000-0000-0000-0000-00000000fee5';
const donorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ownerId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const robotId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function requestHash(amount = 100, message?: string) {
  return createHash('sha256')
    .update(JSON.stringify({ donorId, robotId, amount, message: message?.trim() ?? null }))
    .digest('hex');
}

function build() {
  const tx = {
    walletIdempotencyKey: {
      create: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    robot: {
      findUnique: jest.fn().mockResolvedValue({
        id: robotId,
        ownerId,
        name: 'Bot',
        visibility: 'PUBLIC',
      }),
    },
    walletIdempotencyKey: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const redis = {
    incr: jest.fn().mockResolvedValue(1),
    incrby: jest.fn().mockImplementation((_key: string, amount: number) => Promise.resolve(amount)),
    expire: jest.fn().mockResolvedValue(1),
    decr: jest.fn().mockResolvedValue(0),
    decrby: jest.fn().mockResolvedValue(0),
  };
  const wallet = {
    runSerializable: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    transferInTransaction: jest.fn().mockResolvedValue({
      ledgerGroupId: 'ledger-1', payerBalanceAfter: 400, payeeBalanceAfter: 90, payeeReceived: 90, fee: 10,
    }),
  };
  const platform = { isPlatformUser: jest.fn((id: string) => id === platformId) };
  const features = { assertEnabled: jest.fn() };
  const service = new DonationService(prisma as never, redis as never, wallet as never, platform as never, features as never);
  return { service, tx, prisma, redis, wallet, platform, features };
}

describe('DonationService', () => {
  const valid = { donorId, robotId, amount: 100, idempotencyKey: 'idem-1' };

  it('requires a non-empty idempotency key before doing any work', async () => {
    const { service, features, prisma } = build();
    await expect(service.donate({ donorId, robotId, amount: 100 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.donate({ ...valid, idempotencyKey: ' ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(features.assertEnabled).toHaveBeenCalledWith('DONATIONS');
    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
  });

  it('rejects platform, missing robot, and self donations', async () => {
    const platform = build();
    await expect(platform.service.donate({ ...valid, donorId: platformId })).rejects.toBeInstanceOf(ForbiddenException);

    const missing = build();
    missing.prisma.robot.findUnique.mockResolvedValue(null);
    await expect(missing.service.donate(valid)).rejects.toBeInstanceOf(NotFoundException);

    const self = build();
    self.prisma.robot.findUnique.mockResolvedValue({ id: robotId, ownerId: donorId, name: 'Mine' });
    await expect(self.service.donate(valid)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not disclose private robots through donations', async () => {
    const privateRobot = build();
    privateRobot.prisma.robot.findUnique.mockResolvedValue({
      id: robotId,
      ownerId,
      name: 'Private Bot',
      visibility: 'PRIVATE',
    });

    await expect(privateRobot.service.donate(valid)).rejects.toBeInstanceOf(NotFoundException);
    expect(privateRobot.prisma.walletIdempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns a completed result for an identical retry without rate-limit or ledger writes', async () => {
    const { service, prisma, redis, wallet } = build();
    prisma.walletIdempotencyKey.findUnique.mockResolvedValue({
      requestHash: requestHash(), status: 'COMPLETED', result: { ledgerGroupId: 'existing' },
    });
    await expect(service.donate(valid)).resolves.toEqual({ ledgerGroupId: 'existing' });
    expect(redis.incr).not.toHaveBeenCalled();
    expect(wallet.runSerializable).not.toHaveBeenCalled();
  });

  it('rejects reuse with a different request and an in-progress retry', async () => {
    const mismatch = build();
    mismatch.prisma.walletIdempotencyKey.findUnique.mockResolvedValue({ requestHash: 'different', status: 'COMPLETED', result: {} });
    await expect(mismatch.service.donate(valid)).rejects.toBeInstanceOf(ConflictException);

    const pending = build();
    pending.prisma.walletIdempotencyKey.findUnique.mockResolvedValue({ requestHash: requestHash(), status: 'IN_PROGRESS', result: null });
    await expect(pending.service.donate(valid)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reserves idempotency and transfers both ledger legs in one serializable transaction', async () => {
    const { service, tx, wallet, redis } = build();
    await expect(service.donate({ ...valid, message: ' thanks ' })).resolves.toEqual({
      ledgerGroupId: 'ledger-1', donorBalanceAfter: 400, recipientId: ownerId, received: 90, fee: 10,
    });
    expect(redis.expire).toHaveBeenCalledTimes(2);
    expect(tx.walletIdempotencyKey.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: donorId, scope: 'donation', key: 'idem-1', status: 'IN_PROGRESS' }),
    }));
    expect(wallet.transferInTransaction).toHaveBeenCalledWith(tx, donorId, ownerId, 100, expect.objectContaining({
      payerType: TransactionType.DONATION_SENT,
      payeeType: TransactionType.DONATION_RECEIVED,
      metadata: expect.objectContaining({ message: 'thanks' }),
    }));
    expect(tx.walletIdempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
  });

  it('does not reset existing rate-limit TTLs', async () => {
    const { service, redis } = build();
    redis.incr.mockResolvedValue(2);
    redis.incrby.mockResolvedValue(200);
    await service.donate(valid);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('enforces hourly count and daily credit caps', async () => {
    const hourly = build();
    hourly.redis.incr.mockResolvedValue(LIMITS.DONATIONS_PER_HOUR + 1);
    await expect(hourly.service.donate(valid)).rejects.toBeInstanceOf(ConflictException);
    expect(hourly.wallet.runSerializable).not.toHaveBeenCalled();

    const daily = build();
    daily.redis.incrby.mockResolvedValue(LIMITS.DONATIONS_DAILY_CAP_CREDITS + 1);
    await expect(daily.service.donate(valid)).rejects.toBeInstanceOf(ConflictException);
    expect(daily.wallet.runSerializable).not.toHaveBeenCalled();
  });

  it('rolls rate-limit counters back when the atomic transfer fails', async () => {
    const { service, wallet, redis } = build();
    wallet.runSerializable.mockRejectedValue(new BadRequestException('insufficient'));
    await expect(service.donate(valid)).rejects.toBeInstanceOf(BadRequestException);
    expect(redis.decr).toHaveBeenCalledWith(expect.stringContaining(donorId));
    expect(redis.decrby).toHaveBeenCalledWith(expect.stringContaining(donorId), 100);
  });

  it('returns the winning result after an idempotency reservation race', async () => {
    const { service, prisma, wallet } = build();
    wallet.runSerializable.mockRejectedValue({ code: 'P2002' });
    prisma.walletIdempotencyKey.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ requestHash: requestHash(), status: 'COMPLETED', result: { ledgerGroupId: 'winner' } });
    await expect(service.donate(valid)).resolves.toEqual({ ledgerGroupId: 'winner' });
  });

  it('propagates a reservation collision when no winner can be read', async () => {
    const { service, wallet } = build();
    const collision = Object.assign(new Error('unique collision'), { code: 'P2002' });
    wallet.runSerializable.mockRejectedValue(collision);
    await expect(service.donate(valid)).rejects.toBe(collision);
  });
});
