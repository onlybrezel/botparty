import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService retention', () => {
  it('purges or minimizes every configured content class while retaining newer rows by cutoff', async () => {
    const prisma = {
      chatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $executeRaw: jest.fn().mockResolvedValue(3),
      robotModerationEntry: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      recording: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'recording-1', objectKey: 'sessions/a/camera.mp4' },
          { id: 'recording-2', objectKey: 'sessions/b/camera.mp4' },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const storageDeletion = {
      recordingBucket: 'botparty-recordings',
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MaintenanceService(prisma as never, {} as never, storageDeletion as never);

    await (service as unknown as { _enforceContentRetention: () => Promise<void> })._enforceContentRetention();

    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.robotModerationEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, expiresAt: { lt: expect.any(Date) } },
    }));
    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      prisma,
      'botparty-recordings',
      ['sessions/a/camera.mp4', 'sessions/b/camera.mp4'],
    );
    expect(prisma.recording.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['recording-1', 'recording-2'] } },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } });
  });

  it('executes a maintenance task only for the API instance holding the Redis lock', async () => {
    const redis = {
      set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      eval: jest.fn().mockResolvedValue(1),
    };
    const service = new MaintenanceService({} as never, redis as never, {} as never);
    const work = jest.fn().mockResolvedValue(undefined);
    const lock = service as unknown as {
      _withDistributedLock: (key: string, ttl: number, callback: () => Promise<void>) => Promise<boolean>;
    };

    await expect(lock._withDistributedLock('maintenance:test', 5_000, work)).resolves.toBe(true);
    await expect(lock._withDistributedLock('maintenance:test', 5_000, work)).resolves.toBe(false);

    expect(work).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });
});
